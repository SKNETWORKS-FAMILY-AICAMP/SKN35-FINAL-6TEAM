"""가상 주문 중복 방지."""

import threading

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.core.db import Database
from app.core.errors import ConflictError
from app.db.models import Order
from app.orders.service import create_order
from app.workflows.runner import WorkflowRunner
from tests.helpers import h, put_requirements, quotation, start_session


def _ready_quote(client: TestClient, runner: WorkflowRunner, cid: int) -> tuple[str, str]:
    sid = start_session(client, cid)
    put_requirements(client, cid, sid)
    runner.wait_all()
    return sid, quotation(client, cid, sid)["id"]


def _order(client: TestClient, cid: int, quote_id: str, key: str):
    return client.post(
        "/api/orders", json={"quotation_id": quote_id}, headers={**h(cid), "Idempotency-Key": key}
    )


def test_same_key_returns_same_order(
    client: TestClient, runner: WorkflowRunner, database: Database, companies: dict[str, int]
) -> None:
    cid = companies["public-demo"]
    _, quote_id = _ready_quote(client, runner, cid)

    first = _order(client, cid, quote_id, "order-key-0001")
    second = _order(client, cid, quote_id, "order-key-0001")
    assert first.status_code == 201 and second.status_code == 200
    assert first.json()["id"] == second.json()["id"]
    assert first.json()["is_virtual"] is True

    with database.session() as db:
        assert db.scalar(select(func.count()).select_from(Order)) == 1


def test_concurrent_duplicate_requests_create_one_order(
    client: TestClient, runner: WorkflowRunner, database: Database, companies: dict[str, int]
) -> None:
    cid = companies["public-demo"]
    _, quote_id = _ready_quote(client, runner, cid)
    results: list[str] = []
    barrier = threading.Barrier(4)

    def place() -> None:
        barrier.wait()
        order, _ = create_order(database, cid, quote_id, "order-key-race-01")
        results.append(order.id)

    threads = [threading.Thread(target=place) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=20)

    assert len(results) == 4 and len(set(results)) == 1
    with database.session() as db:
        assert db.scalar(select(func.count()).select_from(Order)) == 1


def test_concurrent_same_key_on_two_quotes_is_one_order_and_one_conflict(
    client: TestClient, runner: WorkflowRunner, database: Database, companies: dict[str, int]
) -> None:
    """서로 다른 세션의 견적 2개에 같은 키로 동시에 주문 — 세션 잠금으로는 줄 세워지지 않는 경우입니다.
    PostgreSQL 유니크 위반 → 롤백 후 다시 읽기 경로를 지나도 주문은 1건, 나머지는 409 여야 합니다."""
    cid = companies["public-demo"]
    _, quote_a = _ready_quote(client, runner, cid)
    _, quote_b = _ready_quote(client, runner, cid)
    barrier = threading.Barrier(2)
    outcomes: list[str] = []

    def place(quote_id: str) -> None:
        barrier.wait()
        try:
            _, created = create_order(database, cid, quote_id, "order-key-race-02")
            outcomes.append("created" if created else "reused")
        except ConflictError:
            outcomes.append("conflict")

    threads = [threading.Thread(target=place, args=(q,)) for q in (quote_a, quote_b)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=20)

    assert sorted(outcomes) == ["conflict", "created"]
    with database.session() as db:
        assert db.scalar(select(func.count()).select_from(Order)) == 1


def test_old_quote_cannot_be_ordered_after_change(
    client: TestClient, runner: WorkflowRunner, companies: dict[str, int]
) -> None:
    cid = companies["public-demo"]
    sid, old_quote = _ready_quote(client, runner, cid)
    put_requirements(client, cid, sid, budget_max=4_000_000)
    runner.wait_all()

    res = _order(client, cid, old_quote, "order-key-0002")
    assert res.status_code == 409


def test_same_key_for_different_quote_is_conflict(
    client: TestClient, runner: WorkflowRunner, companies: dict[str, int]
) -> None:
    cid = companies["public-demo"]
    _, quote_a = _ready_quote(client, runner, cid)
    _, quote_b = _ready_quote(client, runner, cid)
    assert _order(client, cid, quote_a, "order-key-0003").status_code == 201
    assert _order(client, cid, quote_b, "order-key-0003").status_code == 409


def test_short_key_is_rejected(
    client: TestClient, runner: WorkflowRunner, companies: dict[str, int]
) -> None:
    cid = companies["public-demo"]
    _, quote_id = _ready_quote(client, runner, cid)
    assert _order(client, cid, quote_id, "short").status_code == 422
