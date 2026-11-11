"""상태 일관성: 예산 변경 · 늦게 도착한 옛 결과 · 검증 부적합 · 견적 실패 · 재시작 · 재시도."""

import threading

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.contracts.schemas import Team
from app.core.clock import utcnow
from app.core.db import Database
from app.db.models import AgentTask, Recommendation, WorkflowRun
from app.workflows.recovery import sweep_interrupted_runs
from app.workflows.runner import RunContext, WorkflowRunner
from tests.helpers import (
    events,
    get_session,
    h,
    put_requirements,
    quotation,
    recommendations,
    start_session,
)


def test_budget_change_updates_to_latest(
    client: TestClient, runner: WorkflowRunner, companies: dict[str, int]
) -> None:
    cid = companies["public-demo"]
    sid = start_session(client, cid)
    put_requirements(client, cid, sid, budget_max=4_000_000)
    runner.wait_all()
    assert quotation(client, cid, sid)["items"][0]["sku"] == "PUB-LT-003"

    put_requirements(client, cid, sid, budget_max=2_500_000)
    runner.wait_all()

    recs = recommendations(client, cid, sid)
    assert recs and all(r["requirement_version"] == 2 for r in recs)
    assert all(r["product"]["price_amount"] <= 2_500_000 for r in recs)
    quote = quotation(client, cid, sid)
    assert quote["requirement_version"] == 2
    assert quote["items"][0]["sku"] == "PUB-LT-002"


def test_late_old_result_never_overwrites_latest(
    client: TestClient, runner: WorkflowRunner, database: Database, companies: dict[str, int]
) -> None:
    """v1 설계팀이 후보를 저장하기 직전에 멈춘 사이 v2 가 끝나고, 그 뒤 v1 이 저장을 시도하는 상황."""
    cid = companies["public-demo"]
    reached, release = threading.Event(), threading.Event()

    def hold_v1(ctx: RunContext, rank: int) -> None:
        if ctx.version == 1:
            reached.set()
            assert release.wait(timeout=20)

    runner.hooks.before_candidate_saved = hold_v1
    sid = start_session(client, cid)
    put_requirements(client, cid, sid, budget_max=4_000_000)
    assert reached.wait(timeout=10), "v1 이 후보 저장 직전까지 와야 합니다"

    put_requirements(client, cid, sid, budget_max=2_500_000)
    for _ in range(200):
        if get_session(client, cid, sid)["latest_run"]["status"] == "completed":
            break
        threading.Event().wait(0.05)
    release.set()
    runner.wait_all()

    with database.session() as db:
        old_saved = db.scalar(
            select(func.count())
            .select_from(Recommendation)
            .where(Recommendation.session_id == sid, Recommendation.requirement_version == 1)
        )
        runs = {
            r.requirement_version: r.status
            for r in db.scalars(select(WorkflowRun).where(WorkflowRun.session_id == sid))
        }
    assert old_saved == 0, "옛 버전 결과가 저장되면 안 됩니다"
    assert runs == {1: "superseded", 2: "completed"}

    evs = events(client, cid, sid)
    superseded = [e for e in evs if e["type"] == "run.superseded"]
    assert len(superseded) == 1 and superseded[0]["requirement_version"] == 1
    v1_after = [e for e in evs if e["requirement_version"] == 1 and e["seq"] > superseded[0]["seq"]]
    assert v1_after == [], "중단된 v1 이 그 뒤에 이벤트를 남기면 안 됩니다"
    assert quotation(client, cid, sid)["requirement_version"] == 2


def test_all_candidates_rejected_needs_revision(
    client: TestClient, runner: WorkflowRunner, companies: dict[str, int]
) -> None:
    cid = companies["public-demo"]
    sid = start_session(client, cid)
    put_requirements(
        client, cid, sid, budget_max=1_500_000
    )  # 이 예산의 노트북은 모두 RAM 16GB 이하
    runner.wait_all()

    session = get_session(client, cid, sid)
    assert session["latest_run"]["status"] == "needs_revision"
    assert all(r["status"] == "rejected" for r in recommendations(client, cid, sid))
    last = events(client, cid, sid)[-1]
    assert last["type"] == "run.needs_revision" and last["team"] == "design"
    assert client.get(f"/api/sessions/{sid}/quotation", headers=h(cid)).status_code == 404


def test_quotation_failure_is_reported(
    client: TestClient, runner: WorkflowRunner, companies: dict[str, int]
) -> None:
    """조건을 맞춘 서버가 가격 미확인 상품뿐이면 견적을 만들지 않고 실패로 알립니다."""
    cid = companies["public-demo"]
    sid = start_session(client, cid)
    put_requirements(
        client,
        cid,
        sid,
        purpose="서버",
        product_types=["server"],
        budget_max=50_000_000,
        preferences={"min_ram_gb": 1024},
    )
    runner.wait_all()

    assert get_session(client, cid, sid)["latest_run"]["status"] == "failed"
    evs = events(client, cid, sid)
    failed = next(e for e in evs if e["type"] == "task.failed")
    assert failed["team"] == "quotation"
    assert failed["error"] == {
        "code": "PRICE_UNCONFIRMED",
        "message": failed["error"]["message"],
        "retryable": False,
    }
    assert evs[-1]["type"] == "run.failed"
    assert client.get(f"/api/sessions/{sid}/quotation", headers=h(cid)).status_code == 404


def test_restart_sweep_then_retry(
    client: TestClient, runner: WorkflowRunner, database: Database, companies: dict[str, int]
) -> None:
    cid = companies["public-demo"]
    sid = start_session(client, cid)
    put_requirements(client, cid, sid)
    runner.wait_all()

    # 서버가 실행 도중 꺼진 상황을 흉내 냅니다.
    with database.transaction() as db:
        db.add(
            WorkflowRun(
                id="interrupted-run",
                session_id=sid,
                requirement_version=1,
                status="running",
                started_at=utcnow(),
            )
        )
        db.flush()
        db.add(
            AgentTask(
                id="interrupted-task",
                run_id="interrupted-run",
                team="design",
                name="후보 탐색",
                status="running",
                attempt=1,
                started_at=utcnow(),
            )
        )

    assert sweep_interrupted_runs(database) == 1
    session = get_session(client, cid, sid)
    assert session["latest_run"]["id"] == "interrupted-run"
    assert session["latest_run"]["status"] == "failed"
    last = events(client, cid, sid)[-1]
    assert last["type"] == "run.failed"
    assert last["error"]["code"] == "SERVER_RESTART" and last["error"]["retryable"] is True

    res = client.post(f"/api/sessions/{sid}/retry", headers=h(cid))
    assert res.status_code == 200, res.text
    runner.wait_all()
    assert get_session(client, cid, sid)["latest_run"]["status"] == "completed"


def test_transient_failure_is_retried(
    client: TestClient, runner: WorkflowRunner, companies: dict[str, int]
) -> None:
    runner.hooks.fail_attempt = lambda team, attempt: team == Team.design and attempt == 1
    cid = companies["public-demo"]
    sid = start_session(client, cid)
    put_requirements(client, cid, sid)
    runner.wait_all()

    evs = events(client, cid, sid)
    assert any(e["type"] == "task.retrying" and e["team"] == "design" for e in evs)
    assert get_session(client, cid, sid)["latest_run"]["status"] == "completed"


def test_retry_limit_marks_run_failed_retryable(
    client: TestClient, runner: WorkflowRunner, companies: dict[str, int]
) -> None:
    runner.hooks.fail_attempt = lambda team, attempt: team == Team.quotation
    cid = companies["public-demo"]
    sid = start_session(client, cid)
    put_requirements(client, cid, sid)
    runner.wait_all()

    last = events(client, cid, sid)[-1]
    assert last["type"] == "run.failed"
    assert last["error"]["code"] == "AGENT_UNAVAILABLE" and last["error"]["retryable"] is True
