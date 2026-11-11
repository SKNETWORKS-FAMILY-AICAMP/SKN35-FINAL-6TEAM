"""Mock 상담 전체 흐름: 상담 → 설계 → 검증 → 견적, 그리고 이벤트."""

from fastapi.testclient import TestClient

from app.contracts.schemas import AgentEventOut
from app.events.service import format_sse
from app.workflows.runner import WorkflowRunner
from tests.helpers import (
    events,
    get_session,
    h,
    put_requirements,
    quotation,
    recommendations,
    start_session,
)


def test_health_and_companies(client: TestClient) -> None:
    health = client.get("/api/health").json()
    assert health == {"status": "ok", "mode": "mock", "database": "ok"}

    companies = client.get("/api/companies").json()
    slugs = {c["slug"]: c for c in companies}
    assert set(slugs) == {"public-demo", "company-a"}
    assert all(c["is_test_data"] for c in companies)
    assert {t["code"] for t in slugs["company-a"]["product_types"]} == {
        "laptop",
        "desktop",
        "monitor",
    }


def test_full_flow_reaches_quote(
    client: TestClient, runner: WorkflowRunner, companies: dict[str, int]
) -> None:
    cid = companies["public-demo"]
    sid = start_session(client, cid)

    result = put_requirements(client, cid, sid)
    assert result["changed"] is True
    assert result["session"]["current_requirement_version"] == 1
    # 사용 목적 '영상 편집' 에서 세부 조건을 추론했는지
    derived = result["session"]["requirements"]["derived_preferences"]
    assert derived["min_ram_gb"] == 32 and derived["min_vram_gb"] == 8

    runner.wait_all()

    session = get_session(client, cid, sid)
    assert session["latest_run"]["status"] == "completed"
    assert session["latest_run"]["first_candidate_ms"] is not None
    teams = {t["team"] for t in session["latest_run"]["tasks"]}
    assert teams == {"design", "validation", "quotation"}

    recs = recommendations(client, cid, sid)
    assert recs, "후보가 있어야 합니다"
    assert all(r["requirement_version"] == 1 for r in recs)
    assert all(r["product"]["data_status"] == "test" for r in recs)
    statuses = {r["product"]["sku"]: r["status"] for r in recs}
    assert statuses["PUB-LT-002"] == "validated"
    # 메모리 16GB 노트북은 '영상 편집' 조건(32GB)에서 탈락해야 합니다
    rejected = next(r for r in recs if r["product"]["sku"] == "PUB-LT-001")
    assert rejected["status"] == "rejected"
    assert any(c["check_code"] == "SPEC_RAM" and not c["passed"] for c in rejected["checks"])

    quote = quotation(client, cid, sid)
    assert quote["requirement_version"] == 1
    assert [i["sku"] for i in quote["items"]] == ["PUB-LT-002"]
    assert quote["total"] <= 2_500_000
    assert quote["is_reference"] is True
    assert any("테스트 데이터" in note for note in quote["notes"])


def test_events_are_gapless_and_cover_all_teams(
    client: TestClient, runner: WorkflowRunner, companies: dict[str, int]
) -> None:
    cid = companies["public-demo"]
    sid = start_session(client, cid)
    put_requirements(client, cid, sid, product_types=["laptop", "monitor"], budget_max=3_000_000)
    runner.wait_all()

    evs = events(client, cid, sid)
    seqs = [e["seq"] for e in evs]
    assert seqs == list(range(1, len(evs) + 1)), "순번에 빈 번호나 중복이 없어야 합니다"
    assert {e["team"] for e in evs if e["team"]} == {
        "consultation",
        "design",
        "validation",
        "quotation",
    }
    assert evs[-1]["type"] == "run.completed"

    # 검증 작업은 병렬이지만, 시작한 작업은 모두 끝 이벤트가 있어야 합니다
    started = [e for e in evs if e["team"] == "validation" and e["type"] == "task.started"]
    finished = [e for e in evs if e["team"] == "validation" and e["type"] == "task.completed"]
    assert len(started) == len(finished) > 1
    assert get_session(client, cid, sid)["last_event_seq"] == len(evs)


def test_event_replay_after_reconnect(
    client: TestClient, runner: WorkflowRunner, companies: dict[str, int]
) -> None:
    cid = companies["public-demo"]
    sid = start_session(client, cid)
    put_requirements(client, cid, sid)
    runner.wait_all()

    all_events = events(client, cid, sid)
    cut = len(all_events) // 2
    replay = events(client, cid, sid, after=cut)
    assert [e["seq"] for e in replay] == list(range(cut + 1, len(all_events) + 1))

    sse = format_sse(AgentEventOut.model_validate(all_events[0]))
    assert sse.startswith("id: 1\nevent: agent_event\ndata: {")
    assert sse.endswith("\n\n")


def test_same_requirements_do_not_rerun(
    client: TestClient, runner: WorkflowRunner, companies: dict[str, int]
) -> None:
    cid = companies["public-demo"]
    sid = start_session(client, cid)
    put_requirements(client, cid, sid)
    runner.wait_all()
    before = len(events(client, cid, sid))

    again = put_requirements(client, cid, sid)
    runner.wait_all()
    assert again["changed"] is False
    assert again["session"]["current_requirement_version"] == 1
    assert len(events(client, cid, sid)) == before


def test_rejects_unknown_product_type_and_preference(
    client: TestClient, companies: dict[str, int]
) -> None:
    cid = companies["public-demo"]
    sid = start_session(client, cid)
    url = f"/api/sessions/{sid}/requirements"
    bad_type = {"purpose": "사무", "product_types": ["sofa"], "budget_max": 1_000_000}
    assert client.put(url, json=bad_type, headers=h(cid)).status_code == 422
    bad_pref = {
        "purpose": "사무",
        "product_types": ["laptop"],
        "budget_max": 1_000_000,
        "preferences": {"min_ramm_gb": 16},
    }
    res = client.put(url, json=bad_pref, headers=h(cid))
    assert res.status_code == 422
    assert "min_ramm_gb" in res.json()["detail"]
