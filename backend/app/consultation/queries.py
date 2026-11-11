"""상담 세션 조회(화면에 보여 줄 현재 상태). 항상 '현재 요구사항 버전'의 결과만 돌려줍니다."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.catalog.records import ProductRecord
from app.contracts.schemas import (
    ProductOut,
    RecommendationOut,
    RequirementsIn,
    RequirementsOut,
    RunOut,
    SessionOut,
    TaskOut,
    ValidationCheckOut,
)
from app.db.models import (
    AgentTask,
    ConsultationSession,
    Recommendation,
    RequirementVersion,
    ValidationResult,
    WorkflowRun,
)


def latest_run(db: Session, session_row: ConsultationSession) -> WorkflowRun | None:
    return db.scalar(
        select(WorkflowRun)
        .where(
            WorkflowRun.session_id == session_row.id,
            WorkflowRun.requirement_version == session_row.current_requirement_version,
        )
        .order_by(WorkflowRun.started_at.desc())
        .limit(1)
    )


def run_out_by_id(db: Session, run_id: str) -> RunOut:
    run = db.get(WorkflowRun, run_id)
    assert run is not None, f"실행이 없습니다: {run_id}"
    return _run_out(db, run)


def _run_out(db: Session, run: WorkflowRun) -> RunOut:
    tasks = db.scalars(
        select(AgentTask).where(AgentTask.run_id == run.id).order_by(AgentTask.started_at)
    ).all()
    return RunOut(
        id=run.id,
        requirement_version=run.requirement_version,
        status=run.status,
        started_at=run.started_at,
        finished_at=run.finished_at,
        first_candidate_ms=run.first_candidate_ms,
        error_code=run.error_code,
        tasks=[TaskOut.model_validate(t) for t in tasks],
    )


def session_out(db: Session, session_row: ConsultationSession) -> SessionOut:
    requirements = None
    req_row = db.scalar(
        select(RequirementVersion).where(
            RequirementVersion.session_id == session_row.id,
            RequirementVersion.version == session_row.current_requirement_version,
        )
    )
    if req_row is not None:
        requirements = RequirementsOut(
            version=req_row.version,
            input=RequirementsIn.model_validate(req_row.payload["input"]),
            derived_preferences=req_row.payload["derived_preferences"],
            effective_preferences=req_row.payload["effective_preferences"],
        )
    run = latest_run(db, session_row)
    return SessionOut(
        id=session_row.id,
        company_id=session_row.company_id,
        status=session_row.status,
        current_requirement_version=session_row.current_requirement_version,
        last_event_seq=session_row.last_event_seq,
        requirements=requirements,
        latest_run=_run_out(db, run) if run else None,
    )


def list_recommendations(db: Session, session_row: ConsultationSession) -> list[RecommendationOut]:
    run = latest_run(db, session_row)
    if run is None:
        return []
    recs = db.scalars(
        select(Recommendation).where(Recommendation.run_id == run.id).order_by(Recommendation.rank)
    ).all()
    checks: dict[str, list[ValidationCheckOut]] = {r.id: [] for r in recs}
    if recs:
        for row in db.scalars(
            select(ValidationResult)
            .where(ValidationResult.recommendation_id.in_(list(checks)))
            .order_by(ValidationResult.id)
        ):
            checks[row.recommendation_id].append(ValidationCheckOut.model_validate(row))
    return [
        RecommendationOut(
            id=r.id,
            requirement_version=r.requirement_version,
            rank=r.rank,
            product=ProductOut.model_validate(ProductRecord.model_validate(r.product_snapshot)),
            score=r.score,
            reasons=r.reasons,
            status=r.status,
            checks=checks[r.id],
        )
        for r in recs
    ]
