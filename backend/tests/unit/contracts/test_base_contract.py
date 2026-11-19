"""모든 업무 영역이 공유하는 최소 계약 기준 테스트."""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from pathlib import Path

import pytest
from app.contracts.schemas import (
    AgentEventOut,
    ArtifactKind,
    EventType,
    RequirementsIn,
    Team,
    WorkStatus,
)
from pydantic import ValidationError

PROJECT_ROOT = Path(
    os.environ.get("TEST_PROJECT_PATH", Path(__file__).resolve().parents[4])
).resolve()
UNIT_ROOT = Path(__file__).resolve().parents[1]
INVENTORY_PATH = UNIT_ROOT / "inventory.json"

EXPECTED_ENUM_VALUES = {
    Team: ("consultation", "design", "validation", "quotation"),
    WorkStatus: (
        "pending",
        "running",
        "needs_input",
        "needs_revision",
        "completed",
        "failed",
        "cancelled",
        "superseded",
    ),
    EventType: (
        "requirements.updated",
        "run.started",
        "run.completed",
        "run.failed",
        "run.needs_input",
        "run.needs_revision",
        "run.superseded",
        "task.started",
        "task.progress",
        "task.retrying",
        "task.completed",
        "task.failed",
        "task.needs_input",
        "order.created",
    ),
    ArtifactKind: (
        "requirements",
        "recommendation",
        "validation",
        "quotation",
        "order",
    ),
}


def contract_breaking_changes(section: str) -> list[dict[str, object]]:
    inventory = json.loads(INVENTORY_PATH.read_text(encoding="utf-8"))
    return inventory["contractComparison"][section]["breakingChanges"]


def test_environment_contract_has_no_breaking_changes() -> None:
    breaking_changes = contract_breaking_changes("environment")
    assert not breaking_changes, (
        "환경변수 계약에 Breaking 변경이 있습니다: "
        f"{json.dumps(breaking_changes, ensure_ascii=False)}"
    )


def test_api_contract_has_no_breaking_changes() -> None:
    breaking_changes = contract_breaking_changes("api")
    assert not breaking_changes, (
        "API 계약에 Breaking 변경이 있습니다: "
        f"{json.dumps(breaking_changes, ensure_ascii=False)}"
    )


def test_saved_event_schema_matches_event_contract() -> None:
    schema_path = PROJECT_ROOT / "contracts" / "events.schema.json"
    saved_schema = json.loads(schema_path.read_text(encoding="utf-8"))

    assert saved_schema == AgentEventOut.model_json_schema()


@pytest.mark.parametrize(("enum_type", "expected"), EXPECTED_ENUM_VALUES.items())
def test_shared_enum_values_are_stable(
    enum_type: type, expected: tuple[str, ...]
) -> None:
    assert tuple(item.value for item in enum_type) == expected


def test_requirements_reject_unknown_fields() -> None:
    payload = {
        "purpose": "테스트 용도",
        "product_types": ["test-product"],
        "budget_max": 1,
        "unexpected": "공통 계약에 없는 필드",
    }

    with pytest.raises(ValidationError) as error:
        RequirementsIn.model_validate(payload)

    assert error.value.errors()[0]["type"] == "extra_forbidden"


def test_naive_event_datetime_is_normalized_to_utc() -> None:
    event = AgentEventOut(
        seq=1,
        session_id="test-session",
        company_id=1,
        run_id=None,
        requirement_version=1,
        team=None,
        type=EventType.requirements_updated,
        status=WorkStatus.pending,
        occurred_at=datetime(2026, 1, 1),
        message="단위 테스트용 이벤트",
    )

    assert event.occurred_at.tzinfo is UTC
