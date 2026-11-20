"""Isolated, bounded guest sessions. Confirmation lasts for this session only."""

import secrets
from contextlib import contextmanager
from dataclasses import dataclass, field
from threading import Lock
from time import monotonic
from uuid import uuid4

from fastapi import HTTPException

from app.contracts.pc_consult import MessageOut, QuoteIn, QuoteOut, Survey
from app.contracts.schemas import EventError, EventType, Team, WorkStatus
from app.events.service import SessionEventLog, append_event

COOKIE = "bw_pc_guest"
SESSION_TTL = 2 * 60 * 60


@dataclass
class GuestSession:
    log: SessionEventLog
    token: str = field(default_factory=lambda: secrets.token_urlsafe(32))
    operation_lock: Lock = field(default_factory=Lock)
    touched: float = field(default_factory=monotonic)
    active: int = 0
    survey: Survey | None = None
    draft: QuoteOut | None = None
    draft_input: QuoteIn | None = None
    messages: list[MessageOut] = field(default_factory=list)

    def check_survey(self, survey: Survey) -> None:
        if self.survey != survey:
            raise HTTPException(
                409, "설문이 바뀌었습니다. 현재 설문으로 상담을 다시 시작해 주세요."
            )

    @contextmanager
    def work(self, team: Team, label: str, *, final: bool = False):
        # Called inside operation_lock. Reserve space for all work events before doing any work.
        if len(self.log.events) + 6 > 4096:
            raise HTTPException(
                429, "이 상담의 최대 작업 수에 도달했습니다. 새 상담을 시작해 주세요."
            )
        run_id = str(uuid4())

        def record(kind, status, message, *, actor=None, error=None):
            append_event(
                None,
                self.log,
                type=kind,
                status=status,
                message=message,
                run_id=run_id,
                team=actor,
                error=error,
            )

        @contextmanager
        def validation_stage():
            record(
                EventType.task_started, WorkStatus.running, "부품 검증 시작", actor=Team.validation
            )
            try:
                yield
            except Exception:
                record(
                    EventType.task_failed,
                    WorkStatus.failed,
                    "부품 검증 실패",
                    actor=Team.validation,
                )
                raise
            record(
                EventType.task_completed,
                WorkStatus.completed,
                "부품 검증 결과 산출",
                actor=Team.validation,
            )

        record(EventType.run_started, WorkStatus.running, label)
        record(EventType.task_started, WorkStatus.running, label, actor=team)
        try:
            yield validation_stage
        except Exception as exc:
            safe_detail = (
                str(exc.detail) if isinstance(exc, HTTPException) else "작업을 처리하지 못했습니다."
            )
            retryable = not isinstance(exc, HTTPException) or exc.status_code >= 500
            error = EventError(code="CONSULTATION_FAILED", message=safe_detail, retryable=retryable)
            record(EventType.task_failed, WorkStatus.failed, safe_detail, actor=team, error=error)
            record(EventType.run_failed, WorkStatus.failed, safe_detail, error=error)
            raise
        record(EventType.task_completed, WorkStatus.completed, f"{label} 완료", actor=team)
        if final:
            record(
                EventType.run_completed, WorkStatus.completed, "현재 상담의 견적 승인을 마쳤습니다."
            )
        else:
            record(
                EventType.run_needs_input, WorkStatus.needs_input, f"{label} 완료 · 고객 입력 대기"
            )


class GuestSessions:
    def __init__(self, company_id: int, *, capacity: int = 128):
        self.company_id = company_id
        self.capacity = capacity
        self._items: dict[str, GuestSession] = {}
        self._lock = Lock()

    def create(self) -> GuestSession:
        with self._lock:
            cutoff = monotonic() - SESSION_TTL
            expired = [k for k, s in self._items.items() if s.touched < cutoff and not s.active]
            for key in expired:
                del self._items[key]
            if len(self._items) >= self.capacity:
                raise HTTPException(503, "현재 상담이 가득 찼습니다. 잠시 후 다시 시도해 주세요.")
            key = str(uuid4())
            session = GuestSession(SessionEventLog(key, self.company_id))
            self._items[key] = session
            return session

    def _get(self, key: str, token: str | None) -> GuestSession:
        session = self._items.get(key)
        if (
            session is None
            or (not session.active and monotonic() - session.touched >= SESSION_TTL)
            or not token
            or not secrets.compare_digest(session.token.encode(), token.encode())
        ):
            raise HTTPException(404, "상담 세션이 없거나 만료되었습니다. 새 상담을 시작해 주세요.")
        return session

    def read(self, key: str, token: str | None) -> GuestSession:
        with self._lock:
            return self._get(key, token)

    @contextmanager
    def visit(self, key: str, token: str | None):
        with self._lock:
            session = self._get(key, token)
            session.active += 1
        try:
            with session.operation_lock:
                yield session
        finally:
            with self._lock:
                session.touched = monotonic()
                session.active -= 1
