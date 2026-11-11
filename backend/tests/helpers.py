"""테스트 도우미."""

from typing import Any

from fastapi.testclient import TestClient

VIDEO_LAPTOP: dict[str, Any] = {
    "purpose": "영상 편집",
    "product_types": ["laptop"],
    "budget_max": 2_500_000,
}


def h(company_id: int) -> dict[str, str]:
    return {"X-Company-Id": str(company_id)}


def start_session(client: TestClient, company_id: int) -> str:
    res = client.post("/api/sessions", headers=h(company_id))
    assert res.status_code == 201, res.text
    return res.json()["id"]


def put_requirements(
    client: TestClient, company_id: int, session_id: str, **overrides: Any
) -> dict[str, Any]:
    body = {**VIDEO_LAPTOP, **overrides}
    res = client.put(f"/api/sessions/{session_id}/requirements", json=body, headers=h(company_id))
    assert res.status_code == 200, res.text
    return res.json()


def get_session(client: TestClient, company_id: int, session_id: str) -> dict[str, Any]:
    res = client.get(f"/api/sessions/{session_id}", headers=h(company_id))
    assert res.status_code == 200, res.text
    return res.json()


def events(client: TestClient, company_id: int, session_id: str, after: int = 0) -> list[dict]:
    res = client.get(
        f"/api/sessions/{session_id}/events",
        params={"after": after, "limit": 500},
        headers=h(company_id),
    )
    assert res.status_code == 200, res.text
    return res.json()


def recommendations(client: TestClient, company_id: int, session_id: str) -> list[dict]:
    res = client.get(f"/api/sessions/{session_id}/recommendations", headers=h(company_id))
    assert res.status_code == 200, res.text
    return res.json()


def quotation(client: TestClient, company_id: int, session_id: str) -> dict[str, Any]:
    res = client.get(f"/api/sessions/{session_id}/quotation", headers=h(company_id))
    assert res.status_code == 200, res.text
    return res.json()
