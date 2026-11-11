"""상담 세션 · 요구사항 변경 · 다시 시도.

요구사항이 바뀌면 (한 트랜잭션 안에서)
1. 진행 중이던 실행을 superseded 로 닫고
2. 요구사항 버전을 올리고
3. 새 실행을 만듭니다. 커밋 뒤 실행기에 맡깁니다(app/api/routes.py).
앞의 내용과 같은 요구사항이면 아무것도 다시 실행하지 않습니다.
"""

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agents.consultation import structure_requirements
from app.companies.service import get_company
from app.contracts.schemas import (
    ArtifactKind,
    ArtifactRef,
    EventType,
    RequirementsIn,
    Team,
    WorkStatus,
)
from app.core.clock import utcnow
from app.core.db import Database
from app.core.errors import ConflictError, InvalidInputError
from app.db.models import ConsultationSession, RequirementVersion, WorkflowRun
from app.domains import get_pack
from app.events.service import SessionNotFound, append_event, lock_session

OPEN = (WorkStatus.pending.value, WorkStatus.running.value)


def create_session(database: Database, company_id: int) -> str:
    with database.transaction() as db:
        get_company(db, company_id)
        session_id = str(uuid.uuid4())
        db.add(
            ConsultationSession(
                id=session_id,
                company_id=company_id,
                status="active",
                current_requirement_version=0,
                last_event_seq=0,
            )
        )
    return session_id


def get_session_for_company(db: Session, session_id: str, company_id: int) -> ConsultationSession:
    """다른 기업의 세션이면 '없음'으로 처리합니다(시연용 기업 전환일 뿐 인증은 아님)."""
    row = db.get(ConsultationSession, session_id)
    if row is None or row.company_id != company_id:
        raise SessionNotFound(session_id)
    return row


def _new_run(db: Session, session_id: str, version: int) -> str:
    run_id = str(uuid.uuid4())
    db.add(
        WorkflowRun(
            id=run_id,
            session_id=session_id,
            requirement_version=version,
            status=WorkStatus.pending.value,
            started_at=utcnow(),
        )
    )
    return run_id


def update_requirements(
    database: Database, session_id: str, company_id: int, req: RequirementsIn
) -> tuple[bool, str | None]:
    """(바뀌었는지, 새 실행 id) 를 돌려줍니다."""
    with database.transaction() as db:
        session_row = lock_session(db, session_id)
        if session_row.company_id != company_id:
            raise SessionNotFound(session_id)
        pack = get_pack(get_company(db, company_id).domain)

        unknown_types = sorted(set(req.product_types) - set(pack.product_types()))
        if unknown_types:
            raise InvalidInputError(f"알 수 없는 상품 유형입니다: {unknown_types}")
        unknown_prefs = sorted(set(req.preferences) - pack.preference_keys())
        if unknown_prefs:
            raise InvalidInputError(f"알 수 없는 세부 조건입니다: {unknown_prefs}")

        payload = structure_requirements(req, pack)
        latest = db.scalar(
            select(RequirementVersion).where(
                RequirementVersion.session_id == session_id,
                RequirementVersion.version == session_row.current_requirement_version,
            )
        )
        if latest is not None and latest.payload == payload:
            return False, None

        for run in db.scalars(
            select(WorkflowRun).where(
                WorkflowRun.session_id == session_id, WorkflowRun.status.in_(OPEN)
            )
        ):
            run.status = WorkStatus.superseded.value
            run.finished_at = utcnow()
            append_event(
                db,
                session_row,
                type=EventType.run_superseded,
                status=WorkStatus.superseded,
                message=f"요구사항이 바뀌어 v{run.requirement_version} 작업을 중단했습니다",
                run_id=run.id,
                requirement_version=run.requirement_version,
            )

        session_row.current_requirement_version += 1
        version = session_row.current_requirement_version
        db.add(
            RequirementVersion(
                session_id=session_id,
                version=version,
                payload=payload,
                reason="첫 요구사항" if version == 1 else "요구사항 변경",
            )
        )
        types = ", ".join(pack.product_types().get(t, t) for t in req.product_types)
        append_event(
            db,
            session_row,
            type=EventType.requirements_updated,
            status=WorkStatus.completed,
            team=Team.consultation,
            message=f"요구사항 v{version} 정리: {types} · 예산 {req.budget_max:,}원",
            requirement_version=version,
            artifact=ArtifactRef(kind=ArtifactKind.requirements, id=str(version)),
        )
        run_id = _new_run(db, session_id, version)
    return True, run_id


def retry_current(database: Database, session_id: str, company_id: int) -> str:
    """현재 요구사항으로 다시 실행합니다. 이미 진행 중이면 거절합니다."""
    with database.transaction() as db:
        session_row = lock_session(db, session_id)
        if session_row.company_id != company_id:
            raise SessionNotFound(session_id)
        if session_row.current_requirement_version == 0:
            raise ConflictError("아직 요구사항이 없습니다")
        active = db.scalar(
            select(WorkflowRun).where(
                WorkflowRun.session_id == session_id,
                WorkflowRun.requirement_version == session_row.current_requirement_version,
                WorkflowRun.status.in_(OPEN),
            )
        )
        if active is not None:
            raise ConflictError("이미 진행 중인 작업이 있습니다")
        return _new_run(db, session_id, session_row.current_requirement_version)
