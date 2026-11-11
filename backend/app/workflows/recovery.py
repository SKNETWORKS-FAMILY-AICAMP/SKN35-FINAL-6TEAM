"""서버 재시작 뒤 정리.

개발 중에는 코드를 저장할 때마다 서버가 자동으로 다시 켜집니다(--reload). 그때 실행 중이던 작업 스레드는
사라지므로, 켜질 때 '진행 중'으로 남은 실행을 찾아 '실패(재시도 가능)'로 바꾸고 이벤트를 남깁니다.
화면에는 다시 시도 버튼이 보입니다(POST /api/sessions/{id}/retry).
"""

from sqlalchemy import select

from app.contracts.schemas import EventError, EventType, WorkStatus
from app.core.clock import utcnow
from app.core.db import Database
from app.db.models import AgentTask, WorkflowRun
from app.events.service import append_event, lock_session

OPEN = (WorkStatus.pending.value, WorkStatus.running.value)


def sweep_interrupted_runs(database: Database) -> int:
    swept = 0
    with database.transaction() as db:
        runs = db.scalars(select(WorkflowRun).where(WorkflowRun.status.in_(OPEN))).all()
        for run in runs:
            session_row = lock_session(db, run.session_id)
            for task in db.scalars(
                select(AgentTask).where(AgentTask.run_id == run.id, AgentTask.status.in_(OPEN))
            ):
                task.status = WorkStatus.failed.value
                task.error_code = "SERVER_RESTART"
                task.finished_at = utcnow()
            run.finished_at = utcnow()
            if session_row.current_requirement_version != run.requirement_version:
                run.status = WorkStatus.superseded.value
                continue
            run.status = WorkStatus.failed.value
            run.error_code = "SERVER_RESTART"
            append_event(
                db,
                session_row,
                type=EventType.run_failed,
                status=WorkStatus.failed,
                message="서버가 다시 시작되어 작업이 중단됐습니다. 다시 시도해 주세요.",
                run_id=run.id,
                requirement_version=run.requirement_version,
                error=EventError(code="SERVER_RESTART", message="서버 재시작", retryable=True),
            )
            swept += 1
    return swept
