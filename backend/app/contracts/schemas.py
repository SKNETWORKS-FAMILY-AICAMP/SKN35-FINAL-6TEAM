"""API · 이벤트 계약 v0.

규칙
- 필드 이름은 snake_case, 시각은 UTC ISO 8601 문자열입니다.
- 이 파일을 바꾼 PR 은 `scripts/gen-contracts` 로 contracts/ 와 프론트 타입을 다시 만들어 같이 올립니다.
  CI '계약' 잡이 생성물과 다르면 실패시킵니다.
"""

from datetime import UTC, datetime
from enum import StrEnum
from typing import Annotated, Any

from pydantic import AfterValidator, BaseModel, ConfigDict, Field


def _as_utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=UTC)


UtcDatetime = Annotated[datetime, AfterValidator(_as_utc)]


class ContractModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ── 상태값 ────────────────────────────────────────────────────────────


class Team(StrEnum):
    """업무팀. 제품 설명용 논리 역할이며 서버가 따로 있는 것은 아닙니다."""

    consultation = "consultation"  # 상담팀
    design = "design"  # 설계·분석팀
    validation = "validation"  # 검증팀
    quotation = "quotation"  # 견적·주문팀


class WorkStatus(StrEnum):
    """작업·실행 상태. 화면 애니메이션도 이 값만 따릅니다."""

    pending = "pending"
    running = "running"
    needs_input = "needs_input"  # 고객 입력이 더 필요함
    needs_revision = "needs_revision"  # 검증에서 막혀 다시 설계해야 함
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"
    superseded = "superseded"  # 요구사항이 바뀌어 더 이상 유효하지 않음


class EventType(StrEnum):
    requirements_updated = "requirements.updated"
    run_started = "run.started"
    run_completed = "run.completed"
    run_failed = "run.failed"
    run_needs_input = "run.needs_input"
    run_needs_revision = "run.needs_revision"
    run_superseded = "run.superseded"
    task_started = "task.started"
    task_progress = "task.progress"
    task_retrying = "task.retrying"
    task_completed = "task.completed"
    task_failed = "task.failed"
    task_needs_input = "task.needs_input"
    order_created = "order.created"


class ArtifactKind(StrEnum):
    requirements = "requirements"
    recommendation = "recommendation"
    validation = "validation"
    quotation = "quotation"
    order = "order"


# ── 이벤트 ────────────────────────────────────────────────────────────


class EventError(ContractModel):
    code: str = Field(description="오류 코드. 예: PRICE_UNCONFIRMED, SERVER_RESTART")
    message: str
    retryable: bool


class ArtifactRef(ContractModel):
    kind: ArtifactKind
    id: str


class AgentEventOut(ContractModel):
    """업무팀 실행 이벤트 한 건. 화면은 seq 순서로만 처리합니다."""

    seq: int = Field(description="세션 안에서 1부터 빈틈없이 늘어나는 순번")
    session_id: str
    company_id: int
    run_id: str | None
    requirement_version: int = Field(description="이 이벤트가 속한 요구사항 버전")
    team: Team | None = Field(description="null 이면 실행 전체에 대한 이벤트")
    type: EventType
    status: WorkStatus
    occurred_at: UtcDatetime
    message: str
    error: EventError | None = None
    artifact: ArtifactRef | None = None
    metrics: dict[str, float] | None = None


# ── 기업 ──────────────────────────────────────────────────────────────


class ProductTypeOut(ContractModel):
    code: str
    label: str


class CompanyPolicyOut(ContractModel):
    shipping_fee: int
    free_shipping_over: int | None
    discount_rate: float
    quote_valid_days: int


class CompanyOut(ContractModel):
    id: int
    slug: str
    name: str
    description: str
    domain: str
    source_format: str
    product_types: list[ProductTypeOut] = Field(description="이 기업이 취급하는 상품 유형")
    policy: CompanyPolicyOut
    is_test_data: bool


# ── 상담 · 요구사항 ───────────────────────────────────────────────────

PreferenceValue = int | float | bool | str


class RequirementsIn(BaseModel):
    """고객 요구사항. 상담팀이 대화에서 정리한 값입니다(지금은 화면 입력으로 대신합니다)."""

    model_config = ConfigDict(extra="forbid")

    purpose: str = Field(min_length=1, max_length=200, description="사용 목적. 예: 영상 편집")
    product_types: list[str] = Field(
        min_length=1, max_length=4, description="찾을 상품 유형 코드. 예: laptop, monitor"
    )
    budget_max: int = Field(gt=0, le=1_000_000_000, description="총예산(원)")
    preferences: dict[str, PreferenceValue] = Field(
        default_factory=dict, description='세부 조건. 예: {"min_ram_gb": 16}'
    )
    note: str = Field(default="", max_length=500, description="고객이 한 말 원문(선택)")


class RequirementsOut(ContractModel):
    version: int
    input: RequirementsIn
    derived_preferences: dict[str, PreferenceValue] = Field(
        description="사용 목적에서 상담팀이 추론한 조건"
    )
    effective_preferences: dict[str, PreferenceValue] = Field(
        description="실제로 적용한 조건(고객이 직접 준 값이 우선)"
    )


class TaskOut(ContractModel):
    id: str
    team: Team
    name: str
    status: WorkStatus
    attempt: int
    started_at: UtcDatetime | None
    finished_at: UtcDatetime | None
    duration_ms: int | None
    error_code: str | None
    error_message: str | None


class RunOut(ContractModel):
    id: str
    requirement_version: int
    status: WorkStatus
    started_at: UtcDatetime
    finished_at: UtcDatetime | None
    first_candidate_ms: int | None = Field(description="실행 시작부터 첫 후보 저장까지 걸린 시간")
    error_code: str | None
    tasks: list[TaskOut]


class SessionOut(ContractModel):
    id: str
    company_id: int
    status: str
    current_requirement_version: int
    last_event_seq: int
    requirements: RequirementsOut | None
    latest_run: RunOut | None


class RequirementsUpdateOut(ContractModel):
    changed: bool = Field(description="false 면 이전과 같은 요구사항이라 다시 실행하지 않았음")
    session: SessionOut


# ── 상품 · 추천 · 검증 ────────────────────────────────────────────────


class ProductOut(ContractModel):
    sku: str
    product_type: str
    brand: str
    model_name: str
    price_amount: int | None
    currency: str
    price_status: str = Field(description="confirmed | unconfirmed | test")
    data_status: str = Field(description="verified | unverified | test")
    source_url: str | None
    source_note: str
    attributes: dict[str, Any]


class ValidationCheckOut(ContractModel):
    check_code: str
    passed: bool
    severity: str = Field(description="info | warn | block — block 이 실패하면 후보 탈락")
    detail: str


class RecommendationOut(ContractModel):
    id: str
    requirement_version: int
    rank: int
    product: ProductOut
    score: float
    reasons: list[str]
    status: str = Field(description="candidate | validated | rejected")
    checks: list[ValidationCheckOut]


# ── 견적 · 주문 ───────────────────────────────────────────────────────


class QuotationItemOut(ContractModel):
    sku: str
    product_type: str
    brand: str
    model_name: str
    unit_price: int
    quantity: int
    line_total: int
    data_status: str


class QuotationOut(ContractModel):
    id: str
    requirement_version: int
    status: str
    items: list[QuotationItemOut]
    subtotal: int
    shipping_fee: int
    discount: int
    total: int
    currency: str
    notes: list[str]
    valid_until: UtcDatetime
    is_reference: bool = Field(default=True, description="참고 견적(실제 판매가 아님)")


class OrderIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    quotation_id: str


class OrderOut(ContractModel):
    id: str
    company_id: int
    session_id: str
    quotation_id: str
    status: str = Field(description="virtual_created — 실제 결제·배송 없음")
    total: int
    created_at: UtcDatetime
    is_virtual: bool = True


class HealthOut(ContractModel):
    status: str
    mode: str
    database: str
