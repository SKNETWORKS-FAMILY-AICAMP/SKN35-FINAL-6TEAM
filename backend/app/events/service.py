"""이벤트 기록과 조회.

순서 보장 방법 (팀원이 꼭 지킬 것)
- 이벤트는 반드시 `append_event` 로만 넣습니다.
- `append_event` 는 `lock_session` 으로 세션 행을 잠근 트랜잭션 안에서만 부릅니다.
  세션 행을 잠근 채 순번(seq)을 올리고 같은 트랜잭션에서 커밋하므로,
  여러 업무팀이 동시에 이벤트를 남겨도 seq 순서 = 커밋 순서가 되어 빈 번호가 생기지 않습니다.
"""

import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.contracts.schemas import (
    AgentEventOut,
    ArtifactRef,
    EventError,
    EventType,
    Team,
    WorkStatus,
)
from app.core.clock import utcnow
from app.core.db import Database
from app.core.errors import NotFoundError
from app.db.models import AgentEvent, ConsultationSession


class SessionNotFound(NotFoundError):
    def __init__(self, session_id: str) -> None:
        super().__init__(f"상담 세션을 찾을 수 없습니다: {session_id}")


def lock_session(db: Session, session_id: str) -> ConsultationSession:
    row = db.scalar(
        select(ConsultationSession).where(ConsultationSession.id == session_id).with_for_update()
    )
    if row is None:
        raise SessionNotFound(session_id)
    return row


def append_event(
    db: Session,
    session_row: ConsultationSession,
    *,
    type: EventType,
    status: WorkStatus,
    message: str,
    run_id: str | None = None,
    requirement_version: int | None = None,
    team: Team | None = None,
    error: EventError | None = None,
    artifact: ArtifactRef | None = None,
    metrics: dict[str, float] | None = None,
) -> AgentEvent:
    session_row.last_event_seq += 1
    event = AgentEvent(
        session_id=session_row.id,
        seq=session_row.last_event_seq,
        company_id=session_row.company_id,
        run_id=run_id,
        requirement_version=(
            session_row.current_requirement_version
            if requirement_version is None
            else requirement_version
        ),
        team=team.value if team else None,
        type=type.value,
        status=status.value,
        message=message[:500],
        error=error.model_dump(mode="json") if error else None,
        artifact=artifact.model_dump(mode="json") if artifact else None,
        metrics=metrics,
        occurred_at=utcnow(),
    )
    db.add(event)
    return event


def to_event_out(event: AgentEvent) -> AgentEventOut:
    return AgentEventOut.model_validate(event)


def list_events(
    db: Session, session_id: str, after: int = 0, limit: int = 500
) -> list[AgentEventOut]:
    rows = db.scalars(
        select(AgentEvent)
        .where(AgentEvent.session_id == session_id, AgentEvent.seq > after)
        .order_by(AgentEvent.seq)
        .limit(limit)
    ).all()
    return [to_event_out(row) for row in rows]


def fetch_events(database: Database, session_id: str, after: int) -> list[AgentEventOut]:
    """SSE 폴링용. 매번 새 DB 세션을 열어 방금 커밋된 이벤트까지 보이게 합니다."""
    with database.session() as db:
        return list_events(db, session_id, after)


def format_sse(event: AgentEventOut) -> str:
    data: dict[str, Any] = event.model_dump(mode="json")
    return f"id: {event.seq}\nevent: agent_event\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
