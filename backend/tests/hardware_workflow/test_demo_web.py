"""Browser form delivery, single-submit billing and browser-session boundaries."""

import json
import re
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
from fastapi.testclient import TestClient

from app.domains.hardware.consultation_demo import web


@pytest.fixture
def bundle(tmp_path):
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "demo.js").write_text("// fixture", encoding="utf-8")
    (tmp_path / "index.html").write_text(
        "<html><head></head><body></body></html>", encoding="utf-8"
    )
    return tmp_path


def page(response):
    data = re.search(
        r'<script id="demo-state" type="application/json">(.*?)</script>', response.text, re.S
    )
    assert data
    return json.loads(data[1])


def test_cookies_are_private_and_successful_post_redirects_without_repeating_call(
    bundle, monkeypatch, planner
):
    calls = []

    def perform(planner, state, form, *, advisor):
        calls.append(form["action"])
        state.notice = advisor()
        return state

    monkeypatch.setattr(web.flow, "perform", perform)
    message = "검증 <기준> & 대안\u2028확인\u2029완료"
    app = web.create_app(advisor=lambda: message, dist=bundle, planner_factory=lambda: planner)
    with (
        TestClient(app, base_url="http://localhost") as first,
        TestClient(app, base_url="http://localhost") as second,
    ):
        start = first.get("/")
        assert "httponly" in start.headers["set-cookie"].lower()
        assert "samesite=strict" in start.headers["set-cookie"].lower()
        state = page(start)
        assert state["revision"] == 0 and state["phase"] == "survey"
        form = {"action": "chat", "csrf": state["csrf"], "revision": "0"}
        assert second.post("/", data=form).status_code == 403
        other = page(second.get("/"))
        assert other["csrf"] != state["csrf"]
        assert second.post("/", data=form).status_code == 403
        assert first.post("/", data={**form, "csrf": "다름"}).status_code == 403
        response = first.post("/", data=form, follow_redirects=False)
        assert (response.status_code, response.headers["location"]) == (303, "/")
        refreshed = first.get("/")
        assert page(refreshed)["notice"] == message
        assert "<기준>" not in refreshed.text and "\u2028" not in refreshed.text
        assert refreshed.headers["cache-control"] == "no-store"
        assert page(first.get("/"))["revision"] == 1
        stale = first.post("/", data=form)
        assert stale.status_code == 409 and page(stale)["notice"] == message
        assert calls == ["chat"]
        assert page(second.get("/"))["revision"] == 0
        assert first.get("/assets/demo.js").text == "// fixture"


def test_bad_input_and_failed_form_preserve_last_state(bundle, monkeypatch, planner):
    def reject(planner, state, form, *, advisor):
        state.notice = "저장되면 안 되는 임시 변경"
        raise web.flow.InputError("가격을 다시 확인해 주세요.")

    monkeypatch.setattr(web.flow, "perform", reject)
    app = web.create_app(dist=bundle, planner_factory=lambda: planner)
    with TestClient(app, base_url="http://localhost") as client:
        start = page(client.get("/"))
        reply = client.post("/", data={"action": "choose", "revision": 0, "csrf": start["csrf"]})
        assert reply.status_code == 422
        assert page(reply)["error"] == "가격을 다시 확인해 주세요."
        assert page(client.get("/")) == start
        assert client.post("/", json={}).status_code == 415
        headers = {"content-type": "application/x-www-form-urlencoded"}
        assert client.post("/", content="action=a&action=b", headers=headers).status_code == 400
        assert (
            client.post("/", content=b"x=" + b"0" * web._MAX_BODY, headers=headers).status_code
            == 413
        )
        assert client.get("/", headers={"host": "example.test"}).status_code == 400


def test_simultaneous_posts_bill_one_generation(bundle, monkeypatch, planner):
    started, release = Event(), Event()
    calls = []

    def perform(planner, state, form, *, advisor):
        calls.append(form["action"])
        started.set()
        assert release.wait(5)
        return state

    monkeypatch.setattr(web.flow, "perform", perform)
    app = web.create_app(dist=bundle, planner_factory=lambda: planner)
    with TestClient(app, base_url="http://localhost") as client:
        state = page(client.get("/"))
        options = {
            "data": {"action": "chat", "revision": 0, "csrf": state["csrf"]},
            "follow_redirects": False,
        }
        with ThreadPoolExecutor(max_workers=2) as workers:
            first = workers.submit(client.post, "/", **options)
            assert started.wait(5)
            duplicate = workers.submit(client.post, "/", **options)
            release.set()
            assert first.result(timeout=5).status_code == 303
            assert duplicate.result(timeout=5).status_code == 409
        assert calls == ["chat"]


def test_capacity_and_expiry_do_not_evict_an_active_session(monkeypatch):
    clock = [0]
    monkeypatch.setattr(web, "monotonic", lambda: clock[0])
    monkeypatch.setattr(web, "_MAX_SESSIONS", 1)
    sessions = web._Sessions()
    with sessions.visit(None, create=True) as (key, _):
        clock[0] += web._TTL + 1
        with pytest.raises(web._Unavailable), sessions.visit(None, create=True):
            pass
    clock[0] += web._TTL + 1
    with pytest.raises(web._Expired), sessions.visit(key, create=False):
        pass
    with sessions.visit(None, create=True) as (fresh, _):
        assert fresh != key


def test_missing_frontend_returns_local_build_instructions(tmp_path):
    with TestClient(web.create_app(dist=tmp_path), base_url="http://localhost") as client:
        response = client.get("/")
        assert response.status_code == 503
        assert "npm run build" in response.text


def test_database_failure_returns_503_and_next_visit_retries(bundle, monkeypatch, planner):
    calls = []

    def load():
        calls.append(None)
        if len(calls) == 1:
            raise web.PartsCatalogError("internal DB error")
        return planner

    monkeypatch.setattr(web, "_MAX_SESSIONS", 1)
    app = web.create_app(dist=bundle, planner_factory=load)
    assert not calls
    with TestClient(app, base_url="http://localhost") as client:
        failure = client.get("/")
        assert failure.status_code == 503 and "부품 DB" in failure.text
        assert "internal DB error" not in failure.text and "demo-state" not in failure.text
        assert page(client.get("/"))["phase"] == "survey"
        assert client.get("/").status_code == 200 and len(calls) == 2
