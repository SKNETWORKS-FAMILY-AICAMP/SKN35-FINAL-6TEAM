"""API 계약 수집기의 라우트·OpenAPI 병합 규칙을 검증합니다."""

from __future__ import annotations

import json
from pathlib import Path

from tests.unit.discover import discover_declared_routes, discover_openapi_contract


def write_json(path: Path, document: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document), encoding="utf-8")


def test_module_string_constant_prefix_is_resolved(tmp_path: Path) -> None:
    source_path = tmp_path / "backend" / "app" / "api.py"
    source_path.parent.mkdir(parents=True)
    source_path.write_text(
        "\n".join(
            [
                "from fastapi import APIRouter",
                "",
                'PREFIX = "/api/example"',
                "router = APIRouter(prefix=PREFIX)",
                "",
                '@router.post("/sessions")',
                "def create_session() -> None:",
                "    return None",
            ]
        ),
        encoding="utf-8",
    )

    routes = discover_declared_routes(tmp_path, [source_path])

    assert [route["key"] for route in routes] == ["POST /api/example/sessions"]


def test_pc_consult_openapi_is_merged_with_primary_contract(tmp_path: Path) -> None:
    write_json(
        tmp_path / "contracts" / "openapi.json",
        {
            "paths": {"/health": {"get": {"responses": {"200": {}}}}},
            "components": {"schemas": {"Shared": {"type": "string"}}},
        },
    )
    write_json(
        tmp_path / "contracts" / "pc-consult.openapi.json",
        {
            "paths": {"/api/pc-consult/sessions": {"post": {"responses": {"200": {}}}}},
            "components": {"schemas": {"Shared": {"type": "object"}}},
        },
    )

    contract = discover_openapi_contract(tmp_path)

    assert [item["key"] for item in contract["operations"]] == [
        "GET /health",
        "POST /api/pc-consult/sessions",
    ]
    assert [item["key"] for item in contract["schemas"]] == [
        "Shared",
        "pc-consult::Shared",
    ]
    assert contract["error"] is None
