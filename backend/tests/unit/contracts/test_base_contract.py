"""모든 업무 영역이 공유하는 최소 계약 기준 테스트."""

from __future__ import annotations

import json
import os
from datetime import UTC, datetime
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.contracts.schemas import (
    AgentEventOut,
    ArtifactKind,
    EventType,
    RequirementsIn,
    Team,
    WorkStatus,
)
from tests.common.report_checks import breaking_items, comparison_items

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


def record_check(
    request: pytest.FixtureRequest,
    target: str,
    criterion: str,
    expected: object,
    actual: object,
    *,
    inputs: object,
    method: str,
    exclusions: str,
    checks: list[dict] | None = None,
) -> None:
    """실제로 비교한 값만 JUnit 속성으로 남깁니다."""
    for name, value in (
        ("target", target),
        ("criterion", criterion),
        ("expected", expected),
        ("actual", actual),
        ("inputs", inputs),
        ("method", method),
        ("exclusions", exclusions),
        ("location", f"{request.node.location[0]}:{request.node.location[1] + 1}"),
        ("checks", checks if checks is not None else comparison_items(expected, actual, target)),
    ):
        request.node.user_properties.append((name, json.dumps(value, ensure_ascii=False)))


def test_environment_contract_has_no_breaking_changes(
    request: pytest.FixtureRequest,
) -> None:
    breaking_changes = contract_breaking_changes("environment")
    record_check(
        request,
        "inventory.json / environment.breakingChanges",
        "기준 인벤토리 대비 환경변수 삭제·구조 변경이 없어야 함. origins 변경과 신규 추가는 Breaking에서 제외. 실제 접속·비밀값 유효성 검사는 아님.",
        [],
        breaking_changes,
        inputs="현재 수집 환경변수 계약과 저장된 기준 인벤토리",
        method="환경변수 이름으로 대응시켜 기존 항목 삭제·구조 변경을 수집하고 breakingChanges가 빈 목록인지 확인",
        exclusions="신규 환경변수 추가, origins 변경, 비밀값 유효성, 서버 접속은 검사하지 않음",
        checks=breaking_items(breaking_changes, "environment", PROJECT_ROOT),
    )
    assert not breaking_changes, (
        "환경변수 계약에 Breaking 변경이 있습니다: "
        f"{json.dumps(breaking_changes, ensure_ascii=False)}"
    )


def test_api_contract_has_no_breaking_changes(request: pytest.FixtureRequest) -> None:
    breaking_changes = contract_breaking_changes("api")
    record_check(
        request,
        "inventory.json / api.breakingChanges",
        "선언 라우트·OpenAPI operation·schema의 삭제/변경 및 소스↔저장 OpenAPI 불일치가 없어야 함. API 실호출 검사는 아님.",
        [],
        breaking_changes,
        inputs="선언 라우트, 저장 OpenAPI operation/schema, 기준 인벤토리",
        method="기존 계약 삭제·변경 및 소스/저장 OpenAPI의 경로 불일치를 합산한 breakingChanges가 빈 목록인지 확인",
        exclusions="HTTP 요청 실행, 응답 데이터 정확성, 인증/인가 동작, 처리 성능은 검사하지 않음",
        checks=breaking_items(breaking_changes, "api", PROJECT_ROOT),
    )
    assert not breaking_changes, (
        f"API 계약에 Breaking 변경이 있습니다: {json.dumps(breaking_changes, ensure_ascii=False)}"
    )


def test_saved_event_schema_matches_event_contract(
    request: pytest.FixtureRequest,
) -> None:
    schema_path = PROJECT_ROOT / "contracts" / "events.schema.json"
    saved_schema = json.loads(schema_path.read_text(encoding="utf-8"))

    generated_schema = AgentEventOut.model_json_schema()
    record_check(
        request,
        "contracts/events.schema.json ↔ AgentEventOut.model_json_schema()",
        "저장된 JSON Schema 전체 객체와 현재 모델 생성 스키마가 정확히 같아야 함.",
        saved_schema,
        generated_schema,
        inputs="저장 JSON Schema와 현재 AgentEventOut 모델이 생성한 JSON Schema",
        method="두 JSON 객체의 == 비교. 필드·타입·required·제약 등 객체 전체 일치 확인",
        exclusions="실제 이벤트 발행·저장·전송과 개별 이벤트 payload 유효성은 검사하지 않음",
    )
    assert saved_schema == generated_schema


@pytest.mark.parametrize(("enum_type", "expected"), EXPECTED_ENUM_VALUES.items())
def test_shared_enum_values_are_stable(
    enum_type: type, expected: tuple[str, ...], request: pytest.FixtureRequest
) -> None:
    actual = tuple(item.value for item in enum_type)
    record_check(
        request,
        enum_type.__name__,
        "열거형 순회 결과의 value 튜플을 고정 기대 튜플과 비교. 값·개수·순서가 모두 일치해야 함. 멤버명/별칭은 검사하지 않음.",
        expected,
        actual,
        inputs={
            "enum": enum_type.__name__,
            "expected_count": len(expected),
            "actual_count": len(actual),
        },
        method="tuple(item.value for item in enum_type) == expected. 값·개수·순서 전체 비교",
        exclusions="열거형 멤버 이름과 별칭, 업무 상태 전이의 허용 여부는 검사하지 않음",
    )
    assert actual == expected


def test_requirements_reject_unknown_fields(request: pytest.FixtureRequest) -> None:
    payload = {
        "purpose": "테스트 용도",
        "product_types": ["test-product"],
        "budget_max": 1,
        "unexpected": "공통 계약에 없는 필드",
    }

    with pytest.raises(ValidationError) as error:
        RequirementsIn.model_validate(payload)

    actual = error.value.errors()[0]["type"]
    record_check(
        request,
        "RequirementsIn / unexpected 필드",
        "purpose, product_types, budget_max와 미정의 unexpected를 입력하면 ValidationError 발생 및 첫 오류 type이 extra_forbidden이어야 함.",
        "extra_forbidden",
        actual,
        inputs=payload,
        method="RequirementsIn.model_validate(payload)가 ValidationError를 내는지 확인한 뒤 첫 오류의 type 비교",
        exclusions="모든 미정의 필드 조합, 중첩 모델, 나머지 오류 목록은 검사하지 않음",
    )
    assert actual == "extra_forbidden"


def test_naive_event_datetime_is_normalized_to_utc(
    request: pytest.FixtureRequest,
) -> None:
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

    record_check(
        request,
        "AgentEventOut.occurred_at",
        "입력 datetime(2026, 1, 1)의 시간대가 없을 때 결과 tzinfo가 datetime.UTC 객체여야 함. 시각 보존·다른 시간대 변환은 이 테스트에서 검사하지 않음.",
        "tzinfo is UTC",
        {
            "iso": event.occurred_at.isoformat(),
            "tzinfo_is_UTC": event.occurred_at.tzinfo is UTC,
        },
        inputs={"occurred_at": "2026-01-01T00:00:00", "tzinfo": None},
        method="AgentEventOut 생성 후 occurred_at.tzinfo is datetime.UTC 객체 동일성 검사",
        exclusions="시각 자체 보존, 시간대가 있는 입력 변환, DST·경계 날짜는 검사하지 않음",
        checks=comparison_items(True, event.occurred_at.tzinfo is UTC, "occurred_at.tzinfo is UTC"),
    )
    assert event.occurred_at.tzinfo is UTC
