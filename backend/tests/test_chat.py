"""채팅 상담(텍스트 + 선택지) 흐름 · 상담 이력 · 테넌트 격리 · 하드웨어 도구 API."""

import threading
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.core.db import Database
from app.db.models import Recommendation, WorkflowRun
from app.workflows.runner import RunContext, WorkflowRunner
from tests.helpers import events, get_session, h, quotation, recommendations, start_session


def _say(
    client: TestClient,
    cid: int,
    sid: str,
    text: str,
    quick_reply: dict[str, str] | None = None,
    expect: int = 201,
) -> dict[str, Any]:
    body: dict[str, Any] = {"text": text}
    if quick_reply is not None:
        body["quick_reply"] = quick_reply
    res = client.post(f"/api/sessions/{sid}/messages", json=body, headers=h(cid))
    assert res.status_code == expect, res.text
    return res.json()


def test_chat_asks_then_starts_run_and_keeps_history(
    client: TestClient, runner: WorkflowRunner, companies: dict[str, int]
) -> None:
    cid = companies["public-demo"]
    sid = start_session(client, cid)

    first = _say(client, cid, sid, "LLM 파인튜닝용 데스크톱 추천해 주세요")
    assert first["user_message"]["nlu"]["intent"] == "new_recommendation"
    assert first["user_message"]["nlu"]["source"] == "rules"
    assert first["user_message"]["nlu"]["slots"]["product_types"] == ["desktop"]
    assert first["requirements_changed"] is False and first["run_id"] is None
    chips = first["assistant_message"]["quick_replies"]
    assert chips and all(c["slot"] == "budget_max" for c in chips), (
        "빠진 예산을 선택지로 되물어야 합니다"
    )

    budget_chip = next(c for c in chips if c["value"] == "3000000")
    second = _say(
        client, cid, sid, budget_chip["label"], {"slot": "budget_max", "value": "3000000"}
    )
    assert second["requirements_changed"] is True and second["run_id"]
    assert second["requirement_version"] == 1
    runner.wait_all()

    session = get_session(client, cid, sid)
    assert session["latest_run"]["status"] == "completed"
    assert session["requirements"]["input"]["budget_max"] == 3_000_000
    assert session["requirements"]["input"]["product_types"] == ["desktop"]
    assert quotation(client, cid, sid)["requirement_version"] == 1
    assert any(e["type"] == "requirements.updated" for e in events(client, cid, sid))

    history = client.get(f"/api/sessions/{sid}/messages", headers=h(cid)).json()
    assert [m["role"] for m in history] == ["user", "assistant", "user", "assistant"]
    assert history[2]["quick_replies"] == [
        {"label": budget_chip["label"], "slot": "budget_max", "value": "3000000"}
    ]
    assert history[1]["nlu"] is None


def test_chat_slot_change_supersedes_old_run(
    client: TestClient, runner: WorkflowRunner, database: Database, companies: dict[str, int]
) -> None:
    """v1 실행이 후보 저장 직전에 멈춘 사이 채팅으로 예산을 바꾸면, v1 결과는 저장되지 않아야 합니다."""
    cid = companies["public-demo"]
    reached, release = threading.Event(), threading.Event()

    def hold_v1(ctx: RunContext, rank: int) -> None:
        if ctx.version == 1:
            reached.set()
            assert release.wait(timeout=20)

    runner.hooks.before_candidate_saved = hold_v1
    sid = start_session(client, cid)
    first = _say(client, cid, sid, "7B 4비트 QLoRA 파인튜닝할 데스크톱 추천해 주세요. 예산 400만원")
    assert first["requirements_changed"] is True
    req = get_session(client, cid, sid)["requirements"]
    assert req["input"]["preferences"] == {
        "model_params_b": 7.0,
        "precision": "int4",
        "workload": "lora",
    }
    assert req["effective_preferences"]["min_vram_gb"] == 8  # 7 × 0.5 × 1.2 + 3.5 = 7.7 → 8
    assert reached.wait(timeout=10)

    second = _say(client, cid, sid, "예산 300만원으로 바꿀게요")
    assert second["requirements_changed"] is True and second["requirement_version"] == 2
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
    assert old_saved == 0
    assert runs == {1: "superseded", 2: "completed"}
    assert all(r["requirement_version"] == 2 for r in recommendations(client, cid, sid))
    assert quotation(client, cid, sid)["total"] <= 3_000_000


def test_chat_diagnosis_then_cloud_comparison(
    client: TestClient, runner: WorkflowRunner, companies: dict[str, int]
) -> None:
    cid = companies["public-demo"]
    sid = start_session(client, cid)
    diag = _say(
        client,
        cid,
        sid,
        "제 노트북 램 16기가에 내장 그래픽인데 업그레이드하면 7B 돌릴 수 있을까요?",
    )
    assert diag["user_message"]["nlu"]["intent"] == "upgrade_diagnosis"
    assert diag["assistant_message"]["content"].startswith("새 장비 필요")
    assert diag["run_id"] is None

    ask = _say(
        client, cid, sid, "클라우드 GPU 와 비교", {"slot": "intent", "value": "cloud_comparison"}
    )
    assert {c["slot"] for c in ask["assistant_message"]["quick_replies"]} == {"weekly_hours"}

    compare = _say(client, cid, sid, "주 10시간", {"slot": "weekly_hours", "value": "10"})
    content = compare["assistant_message"]["content"]
    assert "개월" in content and "테스트 데이터" in content
    runner.wait_all()
    assert get_session(client, cid, sid)["current_requirement_version"] == 0


def test_chat_rejects_bad_quick_reply_and_other_company(
    client: TestClient, companies: dict[str, int]
) -> None:
    public, company_a = companies["public-demo"], companies["company-a"]
    sid = start_session(client, public)
    _say(client, public, sid, "abc", {"slot": "budget_max", "value": "abc"}, expect=422)
    _say(client, public, sid, "x", {"slot": "intent", "value": "hack"}, expect=422)
    _say(client, public, sid, "", expect=422)

    _say(client, public, sid, "안녕하세요")
    assert client.get(f"/api/sessions/{sid}/messages", headers=h(company_a)).status_code == 404
    _say(client, company_a, sid, "안녕하세요", expect=404)


def test_chat_respects_company_product_types(
    client: TestClient, runner: WorkflowRunner, companies: dict[str, int]
) -> None:
    """가상 기업 A 는 그래픽카드를 취급하지 않습니다 — 그 기업 유형으로 되묻습니다."""
    cid = companies["company-a"]
    sid = start_session(client, cid)
    reply = _say(client, cid, sid, "그래픽카드 추천해 주세요. 예산 100만원")
    assert "취급하지 않아요" in reply["assistant_message"]["content"]
    assert {c["value"] for c in reply["assistant_message"]["quick_replies"]} == {
        "laptop",
        "desktop",
        "monitor",
    }
    runner.wait_all()


def test_tool_apis(client: TestClient, companies: dict[str, int]) -> None:
    public, company_a = companies["public-demo"], companies["company-a"]
    target = {"model_params_b": 7, "precision": "int4", "workload": "lora"}

    vram = client.post("/api/tools/vram-estimate", json=target, headers=h(public))
    assert vram.status_code == 200 and vram.json()["required_vram_gb"] == 7.7
    assert client.post("/api/tools/vram-estimate", json=target).status_code == 422
    bad = {**target, "precision": "int3"}
    assert client.post("/api/tools/vram-estimate", json=bad, headers=h(public)).status_code == 422
    assert (
        client.post("/api/tools/vram-estimate", json=target, headers=h(999_999)).status_code == 404
    )

    diag = client.post(
        "/api/tools/diagnose", json={"owned_sku": "PUB-LT-001", "target": target}, headers=h(public)
    )
    assert diag.status_code == 200 and diag.json()["verdict"] == "new_device_needed"
    # 다른 기업의 상품코드는 '없음'
    other = client.post(
        "/api/tools/diagnose", json={"owned_sku": "A-NB-1002", "target": target}, headers=h(public)
    )
    assert other.status_code == 404
    no_device = client.post("/api/tools/diagnose", json={"target": target}, headers=h(public))
    assert no_device.status_code == 422

    compare = client.post(
        "/api/tools/cloud-compare",
        json={"target": target, "weekly_hours": 10},
        headers=h(company_a),
    )
    assert compare.status_code == 200, compare.text
    body = compare.json()
    assert body["local_option"]["sku"] == "A-NB-1002"  # 가상 기업 A 카탈로그 안에서만 고름
    assert body["breakeven_months"] is not None and body["is_test_data"] is True
