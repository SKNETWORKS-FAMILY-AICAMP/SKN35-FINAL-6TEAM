"""같은 엔진에 기업 2곳(카탈로그 형식 · 정책이 다름)을 연결했을 때."""

from fastapi.testclient import TestClient

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


def test_same_request_two_companies_differ_by_catalog_and_policy(
    client: TestClient, runner: WorkflowRunner, companies: dict[str, int]
) -> None:
    public, company_a = companies["public-demo"], companies["company-a"]
    sid_public = start_session(client, public)
    sid_a = start_session(client, company_a)
    put_requirements(client, public, sid_public)
    put_requirements(client, company_a, sid_a)
    runner.wait_all()

    skus_public = {r["product"]["sku"] for r in recommendations(client, public, sid_public)}
    skus_a = {r["product"]["sku"] for r in recommendations(client, company_a, sid_a)}
    assert skus_public and all(s.startswith("PUB-") for s in skus_public)
    assert skus_a and all(s.startswith("A-") for s in skus_a), "다른 기업 상품이 섞이면 안 됩니다"

    quote_public = quotation(client, public, sid_public)
    quote_a = quotation(client, company_a, sid_a)
    assert quote_public["discount"] == 0
    # 가상 기업 A: 3% 할인, 100만 원 이상 무료배송
    assert quote_a["items"][0]["sku"] == "A-NB-1002"
    assert quote_a["discount"] == round(1_990_000 * 0.03)
    assert quote_a["shipping_fee"] == 0
    assert quote_a["total"] == 1_990_000 - round(1_990_000 * 0.03)


def test_company_without_product_type_asks_for_input(
    client: TestClient, runner: WorkflowRunner, companies: dict[str, int]
) -> None:
    server_request = {
        "purpose": "서버 가상화",
        "product_types": ["server"],
        "budget_max": 10_000_000,
    }
    public, company_a = companies["public-demo"], companies["company-a"]
    sid_public = start_session(client, public)
    sid_a = start_session(client, company_a)
    put_requirements(client, public, sid_public, **server_request)
    put_requirements(client, company_a, sid_a, **server_request)
    runner.wait_all()

    assert get_session(client, public, sid_public)["latest_run"]["status"] == "completed"
    assert get_session(client, company_a, sid_a)["latest_run"]["status"] == "needs_input"
    last = events(client, company_a, sid_a)[-1]
    assert last["type"] == "run.needs_input" and "취급하지 않습니다" in last["message"]


def test_other_company_cannot_see_session(
    client: TestClient, runner: WorkflowRunner, companies: dict[str, int]
) -> None:
    public, company_a = companies["public-demo"], companies["company-a"]
    sid = start_session(client, public)
    put_requirements(client, public, sid)
    runner.wait_all()
    quote_id = quotation(client, public, sid)["id"]

    other = h(company_a)
    for path in ("", "/events", "/recommendations", "/quotation"):
        assert client.get(f"/api/sessions/{sid}{path}", headers=other).status_code == 404, path
    stream = client.get(f"/api/sessions/{sid}/events/stream", params={"company_id": company_a})
    assert stream.status_code == 404
    order = client.post(
        "/api/orders",
        json={"quotation_id": quote_id},
        headers={**other, "Idempotency-Key": "tenant-key-0001"},
    )
    assert order.status_code == 404


def test_unknown_company_header(client: TestClient) -> None:
    assert client.post("/api/sessions", headers=h(999_999)).status_code == 404
    assert client.post("/api/sessions").status_code == 422  # 헤더 없음
