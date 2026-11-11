"""처음 스키마: 기업 · 상품 · 상담 · 실행 · 이벤트 · 추천 · 검증 · 견적 · 가상 주문

Revision ID: 0001
Revises:
Create Date: 2026-11-11
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import mysql

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

TS = mysql.DATETIME(fsp=6)


def upgrade() -> None:
    op.create_table(
        "companies",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("slug", sa.String(length=50), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("description", sa.String(length=255), nullable=False),
        sa.Column("domain", sa.String(length=30), nullable=False),
        sa.Column("source_format", sa.String(length=30), nullable=False),
        sa.Column("policy", sa.JSON(), nullable=False),
        sa.Column("is_test_data", sa.Boolean(), nullable=False),
        sa.Column("created_at", TS, nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_companies"),
        sa.UniqueConstraint("slug", name="uq_companies_slug"),
    )

    op.create_table(
        "products",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column("sku", sa.String(length=64), nullable=False),
        sa.Column("product_type", sa.String(length=30), nullable=False),
        sa.Column("brand", sa.String(length=80), nullable=False),
        sa.Column("model_name", sa.String(length=160), nullable=False),
        sa.Column("price_amount", sa.Integer(), nullable=True),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("price_status", sa.String(length=20), nullable=False),
        sa.Column("data_status", sa.String(length=20), nullable=False),
        sa.Column("source_url", sa.String(length=500), nullable=True),
        sa.Column("source_note", sa.String(length=255), nullable=False),
        sa.Column("attributes", sa.JSON(), nullable=False),
        sa.Column("updated_at", TS, nullable=False),
        sa.ForeignKeyConstraint(
            ["company_id"], ["companies.id"], name="fk_products_company_id_companies"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_products"),
        sa.UniqueConstraint("company_id", "sku", name="uq_products_company_id_sku"),
    )
    op.create_index(
        "ix_products_company_id_product_type", "products", ["company_id", "product_type"]
    )

    op.create_table(
        "consultation_sessions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("current_requirement_version", sa.Integer(), nullable=False),
        sa.Column("last_event_seq", sa.Integer(), nullable=False),
        sa.Column("created_at", TS, nullable=False),
        sa.Column("updated_at", TS, nullable=False),
        sa.ForeignKeyConstraint(
            ["company_id"],
            ["companies.id"],
            name="fk_consultation_sessions_company_id_companies",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_consultation_sessions"),
    )
    op.create_index(
        "ix_consultation_sessions_company_id", "consultation_sessions", ["company_id"]
    )

    op.create_table(
        "requirement_versions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("reason", sa.String(length=255), nullable=False),
        sa.Column("created_at", TS, nullable=False),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["consultation_sessions.id"],
            name="fk_requirement_versions_session_id_consultation_sessions",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_requirement_versions"),
        sa.UniqueConstraint(
            "session_id", "version", name="uq_requirement_versions_session_id_version"
        ),
    )

    op.create_table(
        "workflow_runs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("requirement_version", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("started_at", TS, nullable=False),
        sa.Column("finished_at", TS, nullable=True),
        sa.Column("first_candidate_ms", sa.Integer(), nullable=True),
        sa.Column("error_code", sa.String(length=50), nullable=True),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["consultation_sessions.id"],
            name="fk_workflow_runs_session_id_consultation_sessions",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_workflow_runs"),
    )
    op.create_index("ix_workflow_runs_session_id", "workflow_runs", ["session_id"])

    op.create_table(
        "agent_tasks",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("team", sa.String(length=20), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("attempt", sa.Integer(), nullable=False),
        sa.Column("started_at", TS, nullable=True),
        sa.Column("finished_at", TS, nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("error_code", sa.String(length=50), nullable=True),
        sa.Column("error_message", sa.String(length=500), nullable=True),
        sa.ForeignKeyConstraint(
            ["run_id"], ["workflow_runs.id"], name="fk_agent_tasks_run_id_workflow_runs"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_agent_tasks"),
    )
    op.create_index("ix_agent_tasks_run_id", "agent_tasks", ["run_id"])

    op.create_table(
        "agent_events",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column("run_id", sa.String(length=36), nullable=True),
        sa.Column("requirement_version", sa.Integer(), nullable=False),
        sa.Column("team", sa.String(length=20), nullable=True),
        sa.Column("type", sa.String(length=50), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("message", sa.String(length=500), nullable=False),
        sa.Column("error", sa.JSON(), nullable=True),
        sa.Column("artifact", sa.JSON(), nullable=True),
        sa.Column("metrics", sa.JSON(), nullable=True),
        sa.Column("occurred_at", TS, nullable=False),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["consultation_sessions.id"],
            name="fk_agent_events_session_id_consultation_sessions",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_agent_events"),
        sa.UniqueConstraint("session_id", "seq", name="uq_agent_events_session_id_seq"),
    )

    op.create_table(
        "recommendations",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("requirement_version", sa.Integer(), nullable=False),
        sa.Column("rank", sa.Integer(), nullable=False),
        sa.Column("product_id", sa.Integer(), nullable=True),
        sa.Column("product_snapshot", sa.JSON(), nullable=False),
        sa.Column("score", sa.Float(), nullable=False),
        sa.Column("reasons", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("created_at", TS, nullable=False),
        sa.ForeignKeyConstraint(
            ["product_id"], ["products.id"], name="fk_recommendations_product_id_products"
        ),
        sa.ForeignKeyConstraint(
            ["run_id"], ["workflow_runs.id"], name="fk_recommendations_run_id_workflow_runs"
        ),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["consultation_sessions.id"],
            name="fk_recommendations_session_id_consultation_sessions",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_recommendations"),
    )
    op.create_index("ix_recommendations_product_id", "recommendations", ["product_id"])
    op.create_index("ix_recommendations_run_id", "recommendations", ["run_id"])
    op.create_index("ix_recommendations_session_id", "recommendations", ["session_id"])

    op.create_table(
        "validation_results",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("recommendation_id", sa.String(length=36), nullable=False),
        sa.Column("check_code", sa.String(length=50), nullable=False),
        sa.Column("passed", sa.Boolean(), nullable=False),
        sa.Column("severity", sa.String(length=10), nullable=False),
        sa.Column("detail", sa.String(length=500), nullable=False),
        sa.ForeignKeyConstraint(
            ["recommendation_id"],
            ["recommendations.id"],
            name="fk_validation_results_recommendation_id_recommendations",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_validation_results"),
    )
    op.create_index(
        "ix_validation_results_recommendation_id", "validation_results", ["recommendation_id"]
    )

    op.create_table(
        "quotations",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("requirement_version", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("items", sa.JSON(), nullable=False),
        sa.Column("subtotal", sa.Integer(), nullable=False),
        sa.Column("shipping_fee", sa.Integer(), nullable=False),
        sa.Column("discount", sa.Integer(), nullable=False),
        sa.Column("total", sa.Integer(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("notes", sa.JSON(), nullable=False),
        sa.Column("valid_until", TS, nullable=False),
        sa.Column("created_at", TS, nullable=False),
        sa.ForeignKeyConstraint(
            ["run_id"], ["workflow_runs.id"], name="fk_quotations_run_id_workflow_runs"
        ),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["consultation_sessions.id"],
            name="fk_quotations_session_id_consultation_sessions",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_quotations"),
    )
    op.create_index("ix_quotations_run_id", "quotations", ["run_id"])
    op.create_index("ix_quotations_session_id", "quotations", ["session_id"])

    op.create_table(
        "orders",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("company_id", sa.Integer(), nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("quotation_id", sa.String(length=36), nullable=False),
        sa.Column("idempotency_key", sa.String(length=80), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("total", sa.Integer(), nullable=False),
        sa.Column("created_at", TS, nullable=False),
        sa.ForeignKeyConstraint(
            ["company_id"], ["companies.id"], name="fk_orders_company_id_companies"
        ),
        sa.ForeignKeyConstraint(
            ["quotation_id"], ["quotations.id"], name="fk_orders_quotation_id_quotations"
        ),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["consultation_sessions.id"],
            name="fk_orders_session_id_consultation_sessions",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_orders"),
        sa.UniqueConstraint(
            "company_id", "idempotency_key", name="uq_orders_company_id_idempotency_key"
        ),
    )
    op.create_index("ix_orders_quotation_id", "orders", ["quotation_id"])
    op.create_index("ix_orders_session_id", "orders", ["session_id"])


def downgrade() -> None:
    for table in (
        "orders",
        "quotations",
        "validation_results",
        "recommendations",
        "agent_events",
        "agent_tasks",
        "workflow_runs",
        "requirement_versions",
        "consultation_sessions",
        "products",
        "companies",
    ):
        op.drop_table(table)
