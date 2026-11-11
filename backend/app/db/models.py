"""DB 테이블 정의 (MySQL 8.4).

이 파일을 바꾸면:
1. `uv run alembic revision --autogenerate -m "무엇을 바꿨는지"` 로 마이그레이션을 만들고
2. 생성된 파일을 직접 읽어 확인한 뒤
3. docs/ARCHITECTURE.md 의 DB 표를 같이 고칩니다.
CI 의 `alembic check` 가 모델과 마이그레이션이 다르면 실패시킵니다.

ERD 와 각 컬럼의 뜻은 docs/ARCHITECTURE.md 에 있습니다.
"""

from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    Float,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.mysql import DATETIME
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.core.clock import utcnow

NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

# 마이크로초까지 저장합니다(이벤트 지연 측정용).
Timestamp = DATETIME(fsp=6)


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class Company(Base):
    """판매 기업(테넌트). 카탈로그 형식과 판매 정책이 기업마다 다릅니다."""

    __tablename__ = "companies"
    __table_args__ = (UniqueConstraint("slug"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    slug: Mapped[str] = mapped_column(String(50))
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(String(255), default="")
    domain: Mapped[str] = mapped_column(String(30))
    source_format: Mapped[str] = mapped_column(String(30))
    policy: Mapped[dict[str, Any]] = mapped_column(JSON)
    is_test_data: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow)


class Product(Base):
    """공통 형식으로 바꿔 넣은 상품. 세부 사양은 상품 유형별로 달라 attributes(JSON)에 둡니다."""

    __tablename__ = "products"
    __table_args__ = (
        UniqueConstraint("company_id", "sku"),
        Index("ix_products_company_id_product_type", "company_id", "product_type"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"))
    sku: Mapped[str] = mapped_column(String(64))
    product_type: Mapped[str] = mapped_column(String(30))
    brand: Mapped[str] = mapped_column(String(80))
    model_name: Mapped[str] = mapped_column(String(160))
    price_amount: Mapped[int | None] = mapped_column(Integer, nullable=True)
    currency: Mapped[str] = mapped_column(String(3), default="KRW")
    price_status: Mapped[str] = mapped_column(String(20))
    data_status: Mapped[str] = mapped_column(String(20))
    source_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    source_note: Mapped[str] = mapped_column(String(255), default="")
    attributes: Mapped[dict[str, Any]] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow, onupdate=utcnow)


class ConsultationSession(Base):
    """상담 세션. 현재 요구사항 버전과 마지막 이벤트 순번을 가진 '기준 행'입니다."""

    __tablename__ = "consultation_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    status: Mapped[str] = mapped_column(String(20), default="active")
    current_requirement_version: Mapped[int] = mapped_column(Integer, default=0)
    last_event_seq: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow, onupdate=utcnow)


class RequirementVersion(Base):
    """고객 요구사항의 버전별 기록. 바뀔 때마다 새 행이 생깁니다."""

    __tablename__ = "requirement_versions"
    __table_args__ = (UniqueConstraint("session_id", "version"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("consultation_sessions.id"))
    version: Mapped[int] = mapped_column(Integer)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)
    reason: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow)


class WorkflowRun(Base):
    """한 요구사항 버전에 대한 업무팀 실행 한 번."""

    __tablename__ = "workflow_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("consultation_sessions.id"), index=True)
    requirement_version: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20))
    started_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(Timestamp, nullable=True)
    first_candidate_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(50), nullable=True)


class AgentTask(Base):
    """업무팀 작업 하나(예: 후보 탐색, 후보 1개 검증). 처리 시간 계측 값을 함께 둡니다."""

    __tablename__ = "agent_tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("workflow_runs.id"), index=True)
    team: Mapped[str] = mapped_column(String(20))
    name: Mapped[str] = mapped_column(String(160))
    status: Mapped[str] = mapped_column(String(20))
    attempt: Mapped[int] = mapped_column(Integer, default=1)
    started_at: Mapped[datetime | None] = mapped_column(Timestamp, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(Timestamp, nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    error_message: Mapped[str | None] = mapped_column(String(500), nullable=True)


class AgentEvent(Base):
    """화면으로 보내는 실행 이벤트. (session_id, seq) 가 세션 안의 순서입니다."""

    __tablename__ = "agent_events"
    __table_args__ = (UniqueConstraint("session_id", "seq"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("consultation_sessions.id"))
    seq: Mapped[int] = mapped_column(Integer)
    company_id: Mapped[int] = mapped_column(Integer)
    run_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    requirement_version: Mapped[int] = mapped_column(Integer)
    team: Mapped[str | None] = mapped_column(String(20), nullable=True)
    type: Mapped[str] = mapped_column(String(50))
    status: Mapped[str] = mapped_column(String(20))
    message: Mapped[str] = mapped_column(String(500))
    error: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    artifact: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    metrics: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow)


class Recommendation(Base):
    """추천 후보. 그때의 상품 정보를 스냅샷으로 함께 저장합니다(가격이 나중에 바뀌어도 기록 유지)."""

    __tablename__ = "recommendations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("workflow_runs.id"), index=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("consultation_sessions.id"), index=True)
    requirement_version: Mapped[int] = mapped_column(Integer)
    rank: Mapped[int] = mapped_column(Integer)
    product_id: Mapped[int | None] = mapped_column(
        ForeignKey("products.id"), nullable=True, index=True
    )
    product_snapshot: Mapped[dict[str, Any]] = mapped_column(JSON)
    score: Mapped[float] = mapped_column(Float)
    reasons: Mapped[list[str]] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow)


class ValidationResult(Base):
    """검증팀이 후보 하나에 대해 확인한 항목 하나."""

    __tablename__ = "validation_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    recommendation_id: Mapped[str] = mapped_column(ForeignKey("recommendations.id"), index=True)
    check_code: Mapped[str] = mapped_column(String(50))
    passed: Mapped[bool] = mapped_column(Boolean)
    severity: Mapped[str] = mapped_column(String(10))
    detail: Mapped[str] = mapped_column(String(500))


class Quotation(Base):
    """참고 견적. 실제 판매가·재고가 확인된 견적이 아닙니다."""

    __tablename__ = "quotations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("consultation_sessions.id"), index=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("workflow_runs.id"), index=True)
    requirement_version: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20))
    items: Mapped[list[dict[str, Any]]] = mapped_column(JSON)
    subtotal: Mapped[int] = mapped_column(Integer)
    shipping_fee: Mapped[int] = mapped_column(Integer)
    discount: Mapped[int] = mapped_column(Integer)
    total: Mapped[int] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String(3))
    notes: Mapped[list[str]] = mapped_column(JSON)
    valid_until: Mapped[datetime] = mapped_column(Timestamp)
    created_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow)


class Order(Base):
    """가상 주문. 실제 결제·배송은 없습니다. 같은 멱등 키로는 한 번만 만들어집니다."""

    __tablename__ = "orders"
    __table_args__ = (UniqueConstraint("company_id", "idempotency_key"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"))
    session_id: Mapped[str] = mapped_column(ForeignKey("consultation_sessions.id"), index=True)
    quotation_id: Mapped[str] = mapped_column(ForeignKey("quotations.id"), index=True)
    idempotency_key: Mapped[str] = mapped_column(String(80))
    status: Mapped[str] = mapped_column(String(20))
    total: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(Timestamp, default=utcnow)
