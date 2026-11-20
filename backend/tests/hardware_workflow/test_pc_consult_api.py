"""Public entry points, anonymous ownership, replay and quote approval boundaries."""

import asyncio
import json
from copy import deepcopy

import pytest
from fastapi import Request
from fastapi.testclient import TestClient

from app.api.pc_consult import stream
from app.api.pc_sessions import COOKIE
from app.core.config import REPO_ROOT
from app.domains.hardware.pc_consultation import service
from app.domains.hardware.pc_consultation.parts_db import PartsCatalogError
from app.main import create_app

SURVEY = {
    "mode": "replacement",
    "budget": 200_000,
    "purposes": ["other"],
    "resolution": "fhd",
    "frameRate": "60",
    "workScale": "basic",
    "problems": ["storage"],
    "problemNote": "",
    "owned": {"storage": {"category": "storage", "name": "테스트 보유 부품", "part_id": None}},
}


def test_published_contract_matches_the_running_app():
    path = REPO_ROOT / "contracts" / "pc-consult.openapi.json"
    assert create_app().openapi() == json.loads(path.read_text(encoding="utf-8"))


@pytest.fixture
def visit(monkeypatch):
    app = create_app()
    client = TestClient(app)
    session = client.post("/api/pc-consult/sessions")
    assert session.status_code == 201
    url = "/api/pc-consult/sessions/" + session.json()["session_id"]
    monkeypatch.setattr(
        service,
        "plan",
        lambda survey: {
            "steps": ["storage"],
            "reasons": {},
            "allocations": {"storage": survey["budget"]},
            "criteria": [],
        },
    )
    assert client.post(url + "/plan", json={"survey": SURVEY}).status_code == 200
    return client, url, app


def test_scope_errors_events_and_messages(visit, monkeypatch):
    client, url, app = visit
    other = TestClient(app)
    assert other.get(url + "/events", headers={"X-Company-Id": "1"}).status_code == 404
    assert other.get(url + "/messages").status_code == 404
    assert other.get(url + "/events/stream").status_code == 404
    assert client.get(url + "/events/stream", headers={"Last-Event-ID": "bad"}).status_code == 422

    def unavailable(*_args, **_kwargs):
        raise PartsCatalogError("카탈로그 연결 실패")

    monkeypatch.setattr(service, "candidates", unavailable)
    query = {"survey": SURVEY, "category": "storage", "selected": {}, "budget": 200_000}
    assert client.post(url + "/candidates", json=query).status_code == 503
    history = client.get(url + "/events").json()
    assert [e["seq"] for e in history] == list(range(1, len(history) + 1))
    assert history[-1]["type"] == "run.failed"
    assert history[-1]["error"]["retryable"]
    assert client.get(url + "/events", params={"after": history[-2]["seq"]}).json() == history[-1:]

    monkeypatch.setattr(service, "chat", lambda *_: {"text": "테스트 응답", "sources": []})
    response = client.post(url + "/messages", json={"text": "부품을 확인해 주세요."})
    assert response.status_code == 200
    messages = client.get(url + "/messages").json()
    assert messages == response.json()["messages"]
    assert [m["role"] for m in messages] == ["user", "assistant"]


def test_approval_rechecks_prices_consent_and_versions(visit, monkeypatch):
    client, url, _ = visit
    catalog = {
        "items": [
            {
                "source_key": "test-storage",
                "category": "storage",
                "part_id": 123,
                "part_name_snapshot": "테스트 저장장치",
                "unit_price": 80000,
                "quantity": 1,
                "price_checked_at": None,
            }
        ],
        "total_amount": 80000,
        "validation": {"status": "CONDITIONAL", "basis": "api", "checks": []},
    }

    def quote(*_, validation_stage):
        with validation_stage():
            return deepcopy(catalog)

    monkeypatch.setattr(service, "quote", quote)
    request = {"survey": SURVEY, "selected": {"storage": 123}, "version": 1}
    draft = client.post(url + "/quotes", json=request).json()
    assert draft["status"] == "DRAFT"
    assert client.post(url + "/quotes", json=request).json() == draft
    confirm = {"quote_id": draft["quote_id"], "accept_conditions": False}
    target = url + "/quotes/1/confirm"
    assert client.post(target, json=confirm).status_code == 422
    confirm["accept_conditions"] = True
    catalog["items"][0]["unit_price"] = catalog["total_amount"] = 84000
    assert client.post(target, json=confirm).status_code == 409
    draft2 = client.post(url + "/quotes", json={**request, "version": 2}).json()
    assert client.post(target, json=confirm).status_code == 409
    confirm["quote_id"] = draft2["quote_id"]
    target = url + "/quotes/2/confirm"
    first = client.post(target, json=confirm)
    assert first.status_code == 200
    assert first.json()["storage"] == "session"
    assert first.json()["quote"]["status"] == "CONFIRMED"
    assert first.json()["quote"]["total_amount"] == 84000
    assert client.post(target, json=confirm).json() == first.json()
    assert client.post(url + "/plan", json={"survey": SURVEY}).status_code == 200
    assert client.post(target, json=confirm).status_code == 409


def test_refuses_client_prices_and_stale_survey(visit):
    client, url, _ = visit
    query = {
        "survey": SURVEY,
        "selected": {"storage": {"part_id": 123, "current_price": 0}},
        "version": 1,
    }
    assert client.post(url + "/quotes", json=query).status_code == 422
    query.update(survey={**SURVEY, "budget": 999999}, selected={"storage": 123})
    assert client.post(url + "/quotes", json=query).status_code == 409


def test_sse_resumes_from_last_event_id(visit):
    client, url, app = visit
    history = client.get(url + "/events").json()
    cursor = history[-2]["seq"]

    async def receive():
        await asyncio.Event().wait()

    request = Request(
        {
            "type": "http",
            "app": app,
            "method": "GET",
            "path": url + "/events/stream",
            "headers": [
                (b"cookie", f"{COOKIE}={client.cookies[COOKIE]}".encode()),
                (b"last-event-id", str(cursor).encode()),
            ],
        },
        receive=receive,
    )

    async def read_next_event():
        response = await stream(request, url.rsplit("/", 1)[-1], after=0)
        assert response.media_type == "text/event-stream"
        chunks = response.body_iterator
        try:
            assert await anext(chunks) == ": connected\n\n"
            return await anext(chunks)
        finally:
            await chunks.aclose()

    lines = asyncio.run(read_next_event()).splitlines()
    assert lines[0] == f"id: {cursor + 1}"
    assert json.loads(lines[1].removeprefix("data: ")) == history[-1]
