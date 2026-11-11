"""업무팀 실행기.

흐름 (요구사항 버전 하나당 실행 1번)
  상담팀 정리 → 설계팀 후보 탐색 → 후보가 나오는 대로 검증팀이 후보별로 병렬 검사
  → 모든 검증이 끝나면 견적팀이 참고 견적 작성

지켜야 할 규칙
1. 결과 저장은 전부 `_guarded` 안에서 합니다. 세션 행을 잠그고 요구사항 버전이 그대로인지 확인한 뒤
   저장하므로, 늦게 끝난 옛 작업이 최신 결과를 덮어쓰지 못합니다(Superseded 로 멈춤).
2. 이벤트는 `append_event` 로만 남깁니다(순번 보장 — app/events/service.py).
3. 서버(Uvicorn) 프로세스는 1개로 실행합니다. 실행 상태를 이 프로세스의 스레드가 들고 있기 때문입니다.
   서버가 다시 켜지면 recovery.sweep_interrupted_runs 가 멈춘 실행을 '실패(재시도 가능)'로 정리합니다.
"""

import logging
import threading
import time
import uuid
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from concurrent.futures import wait as wait_futures
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agents.design import Candidate, rank_candidates
from app.agents.quotation import QuotationError, QuoteDraft, build_quote
from app.agents.validation import check_candidate, is_passed
from app.catalog.repository import list_products
from app.companies.policy import CompanyPolicy
from app.companies.service import load_policy
from app.contracts.schemas import (
    ArtifactKind,
    ArtifactRef,
    EventError,
    EventType,
    RequirementsIn,
    Team,
    WorkStatus,
)
from app.core.clock import elapsed_ms, monotonic_ms, utcnow
from app.core.config import Settings
from app.core.db import Database
from app.db.models import (
    AgentTask,
    Company,
    ConsultationSession,
    Quotation,
    Recommendation,
    RequirementVersion,
    ValidationResult,
    WorkflowRun,
)
from app.domains import get_pack
from app.domains.base import DomainPack
from app.events.service import append_event, lock_session

logger = logging.getLogger("buildwise.workflow")


class Superseded(Exception):
    """요구사항이 바뀌어 이 실행의 결과를 저장하면 안 됩니다."""


class TransientAgentError(Exception):
    """다시 시도하면 될 수 있는 일시 오류(외부 API 시간 초과 등)."""


class RunAborted(Exception):
    """실행을 실패로 기록하고 멈췄습니다(추가 처리 없음)."""


@dataclass
class RunnerHooks:
    """테스트 전용 끼어들기 지점. 운영 코드에서는 설정하지 않습니다."""

    before_candidate_saved: Callable[[RunContext, int], None] | None = None
    fail_attempt: Callable[[Team, int], bool] | None = None


@dataclass(frozen=True)
class RunContext:
    run_id: str
    session_id: str
    company_id: int
    version: int
    product_types: list[str]
    budget_max: int
    prefs: dict[str, Any]
    policy: CompanyPolicy
    pack: DomainPack
    created_at: datetime


@dataclass
class TaskHandle:
    id: str
    team: Team
    name: str
    started_ms: float = field(default_factory=monotonic_ms)
    attempt: int = 1


@dataclass(frozen=True)
class ValidationOutcome:
    recommendation_id: str
    candidate: Candidate
    passed: bool


def _ms_since(start: datetime) -> int:
    return max(0, round((utcnow() - start).total_seconds() * 1000))


class WorkflowRunner:
    def __init__(self, database: Database, settings: Settings) -> None:
        self.database = database
        self.delay_s = settings.mock_delay_ms / 1000
        self.max_attempts = max(1, settings.max_retries)
        self._run_pool = ThreadPoolExecutor(settings.run_workers, thread_name_prefix="bw-run")
        self._check_pool = ThreadPoolExecutor(
            settings.validation_workers, thread_name_prefix="bw-check"
        )
        self._futures: dict[str, Future[None]] = {}
        self._lock = threading.Lock()
        self.hooks = RunnerHooks()

    # ── 바깥에서 쓰는 메서드 ──────────────────────────────────────────

    def submit(self, run_id: str) -> None:
        future = self._run_pool.submit(self._execute, run_id)
        with self._lock:
            self._futures[run_id] = future

    def wait_all(self, timeout: float = 30.0) -> None:
        """지금까지 맡긴 실행이 모두 끝날 때까지 기다립니다(테스트 · 스크립트용)."""
        deadline = time.monotonic() + timeout
        while True:
            with self._lock:
                futures = list(self._futures.values())
            remaining = deadline - time.monotonic()
            _, pending = wait_futures(futures, timeout=max(0.0, remaining))
            if pending:
                raise TimeoutError(f"실행 {len(pending)}개가 {timeout}초 안에 끝나지 않았습니다")
            with self._lock:
                if len(self._futures) == len(futures):
                    return

    def shutdown(self) -> None:
        self._run_pool.shutdown(wait=False, cancel_futures=True)
        self._check_pool.shutdown(wait=False, cancel_futures=True)

    # ── 실행 본체 ─────────────────────────────────────────────────────

    def _execute(self, run_id: str) -> None:
        try:
            self._run(run_id)
        except Superseded:
            self._cancel_open_tasks(run_id)
        except RunAborted:
            pass
        except Exception as exc:
            logger.exception("실행 %s 중 예상하지 못한 오류", run_id)
            self._fail_unexpected(run_id, exc)

    def _run(self, run_id: str) -> None:
        ctx = self._load_context(run_id)

        def mark_running(db: Session, s: ConsultationSession) -> None:
            run = db.get(WorkflowRun, ctx.run_id)
            assert run is not None
            run.status = WorkStatus.running.value
            self._event(
                db,
                s,
                ctx,
                EventType.run_started,
                WorkStatus.running,
                None,
                f"요구사항 v{ctx.version} 작업 시작",
            )

        self._guarded(ctx, mark_running)

        supported = [t for t in ctx.product_types if t in ctx.policy.supported_product_types]
        unsupported = [t for t in ctx.product_types if t not in supported]
        if unsupported:
            labels = ", ".join(ctx.pack.product_types().get(t, t) for t in unsupported)
            if not supported:
                self._finish_run(
                    ctx,
                    WorkStatus.needs_input,
                    EventType.run_needs_input,
                    f"이 기업은 {labels} 을(를) 취급하지 않습니다. 다른 상품 유형을 골라 주세요.",
                    team=Team.consultation,
                )
                return
            self._guarded(
                ctx,
                lambda db, s: self._event(
                    db,
                    s,
                    ctx,
                    EventType.task_progress,
                    WorkStatus.completed,
                    Team.consultation,
                    f"취급하지 않는 유형은 제외했습니다: {labels}",
                ),
            )

        # 설계팀 — 후보 탐색
        design = self._start_task(ctx, Team.design, "후보 탐색")
        candidates = self._attempt(ctx, design, lambda: self._find_candidates(ctx, supported))
        if not candidates:
            self._finish_task(
                ctx,
                design,
                WorkStatus.needs_input,
                EventType.task_needs_input,
                "조건에 맞는 상품이 없습니다. 예산이나 조건을 바꿔 주세요.",
            )
            self._finish_run(
                ctx,
                WorkStatus.needs_input,
                EventType.run_needs_input,
                "고객 확인이 필요합니다",
                team=Team.consultation,
            )
            return

        # 후보가 하나 저장될 때마다 바로 검증을 맡깁니다(설계와 검증이 겹쳐 진행).
        futures: list[Future[ValidationOutcome]] = []
        for rank, candidate in enumerate(candidates, start=1):
            self._pause()
            if self.hooks.before_candidate_saved:
                self.hooks.before_candidate_saved(ctx, rank)
            rec_id = self._save_candidate(ctx, rank, candidate)
            futures.append(self._check_pool.submit(self._validate_one, ctx, rec_id, candidate))
        self._finish_task(
            ctx,
            design,
            WorkStatus.completed,
            EventType.task_completed,
            f"후보 {len(candidates)}개를 찾았습니다",
            metrics={"candidates": len(candidates)},
        )

        outcomes = [
            f.result() for f in futures
        ]  # 검증 중 Superseded 가 나면 여기서 다시 올라옵니다
        passed = [o for o in outcomes if o.passed]
        missing = [
            t for t in supported if not any(o.candidate.product.product_type == t for o in passed)
        ]
        if missing:
            labels = ", ".join(ctx.pack.product_types().get(t, t) for t in missing)
            self._finish_run(
                ctx,
                WorkStatus.needs_revision,
                EventType.run_needs_revision,
                f"{labels} 후보가 모두 검증에서 탈락했습니다. 조건을 바꾸거나 다시 설계해야 합니다.",
                team=Team.design,
            )
            return

        # 견적팀 — 참고 견적
        quote_task = self._start_task(ctx, Team.quotation, "참고 견적 작성")
        self._pause()
        try:
            draft = self._attempt(
                ctx,
                quote_task,
                lambda: build_quote(
                    [o.candidate for o in passed], supported, ctx.budget_max, ctx.policy, utcnow()
                ),
            )
        except QuotationError as exc:
            error = EventError(code=exc.code, message=exc.message, retryable=exc.retryable)
            self._finish_task(
                ctx, quote_task, WorkStatus.failed, EventType.task_failed, exc.message, error=error
            )
            self._finish_run(
                ctx,
                WorkStatus.failed,
                EventType.run_failed,
                "견적을 만들지 못했습니다",
                error=error,
            )
            return
        self._save_quote(ctx, quote_task, draft)
        self._finish_run(
            ctx, WorkStatus.completed, EventType.run_completed, "추천 · 검증 · 견적이 끝났습니다"
        )

    # ── 업무팀별 단계 ─────────────────────────────────────────────────

    def _find_candidates(self, ctx: RunContext, product_types: list[str]) -> list[Candidate]:
        with self.database.session() as db:
            products = list_products(db, ctx.company_id, product_types)
        self._pause()
        return rank_candidates(
            products, product_types, ctx.budget_max, ctx.prefs, ctx.policy, ctx.pack
        )

    def _save_candidate(self, ctx: RunContext, rank: int, candidate: Candidate) -> str:
        rec_id = str(uuid.uuid4())

        def write(db: Session, s: ConsultationSession) -> None:
            db.add(
                Recommendation(
                    id=rec_id,
                    run_id=ctx.run_id,
                    session_id=ctx.session_id,
                    requirement_version=ctx.version,
                    rank=rank,
                    product_id=candidate.product.id,
                    product_snapshot=candidate.product.snapshot(),
                    score=candidate.score,
                    reasons=candidate.reasons,
                    status="candidate",
                )
            )
            metrics = None
            if rank == 1:
                run = db.get(WorkflowRun, ctx.run_id)
                assert run is not None
                run.first_candidate_ms = _ms_since(run.started_at)
                metrics = {"first_candidate_ms": float(run.first_candidate_ms)}
            self._event(
                db,
                s,
                ctx,
                EventType.task_progress,
                WorkStatus.running,
                Team.design,
                f"후보 {rank}: {candidate.product.brand} {candidate.product.model_name}",
                artifact=ArtifactRef(kind=ArtifactKind.recommendation, id=rec_id),
                metrics=metrics,
            )

        self._guarded(ctx, write)
        return rec_id

    def _validate_one(
        self, ctx: RunContext, rec_id: str, candidate: Candidate
    ) -> ValidationOutcome:
        task = self._start_task(ctx, Team.validation, f"검증: {candidate.product.model_name}")
        self._pause()
        checks = self._attempt(
            ctx,
            task,
            lambda: check_candidate(
                candidate.product, ctx.budget_max, ctx.prefs, ctx.policy, ctx.pack
            ),
        )
        passed = is_passed(checks)
        blocked = [c.detail for c in checks if c.severity == "block" and not c.passed]

        def extra(db: Session) -> None:
            for c in checks:
                db.add(
                    ValidationResult(
                        recommendation_id=rec_id,
                        check_code=c.code,
                        passed=c.passed,
                        severity=c.severity,
                        detail=c.detail[:500],
                    )
                )
            rec = db.get(Recommendation, rec_id)
            assert rec is not None
            rec.status = "validated" if passed else "rejected"

        message = "통과" if passed else "부적합 — " + "; ".join(blocked[:2])
        self._finish_task(
            ctx,
            task,
            WorkStatus.completed,
            EventType.task_completed,
            f"{candidate.product.model_name}: {message}",
            artifact=ArtifactRef(kind=ArtifactKind.validation, id=rec_id),
            metrics={"passed": 1.0 if passed else 0.0},
            extra=extra,
        )
        return ValidationOutcome(rec_id, candidate, passed)

    def _save_quote(self, ctx: RunContext, task: TaskHandle, draft: QuoteDraft) -> str:
        quote_id = str(uuid.uuid4())

        def extra(db: Session) -> None:
            db.add(
                Quotation(
                    id=quote_id,
                    session_id=ctx.session_id,
                    run_id=ctx.run_id,
                    requirement_version=ctx.version,
                    status="ready",
                    items=draft.items,
                    subtotal=draft.subtotal,
                    shipping_fee=draft.shipping_fee,
                    discount=draft.discount,
                    total=draft.total,
                    currency=draft.currency,
                    notes=draft.notes,
                    valid_until=draft.valid_until,
                )
            )

        self._finish_task(
            ctx,
            task,
            WorkStatus.completed,
            EventType.task_completed,
            f"참고 견적 {draft.total:,}원",
            artifact=ArtifactRef(kind=ArtifactKind.quotation, id=quote_id),
            metrics={"total": float(draft.total)},
            extra=extra,
        )
        return quote_id

    # ── 공통 도우미 ───────────────────────────────────────────────────

    def _load_context(self, run_id: str) -> RunContext:
        with self.database.session() as db:
            run = db.get(WorkflowRun, run_id)
            assert run is not None, f"실행이 없습니다: {run_id}"
            session = db.get(ConsultationSession, run.session_id)
            assert session is not None
            company = db.get(Company, session.company_id)
            assert company is not None
            req_row = db.scalar(
                select(RequirementVersion).where(
                    RequirementVersion.session_id == session.id,
                    RequirementVersion.version == run.requirement_version,
                )
            )
            assert req_row is not None
            requirements = RequirementsIn.model_validate(req_row.payload["input"])
            return RunContext(
                run_id=run.id,
                session_id=session.id,
                company_id=company.id,
                version=run.requirement_version,
                product_types=requirements.product_types,
                budget_max=requirements.budget_max,
                prefs=dict(req_row.payload["effective_preferences"]),
                policy=load_policy(company),
                pack=get_pack(company.domain),
                created_at=run.started_at,
            )

    def _guarded[T](self, ctx: RunContext, fn: Callable[[Session, ConsultationSession], T]) -> T:
        """세션 행을 잠그고 요구사항 버전이 그대로일 때만 fn 을 실행·커밋합니다."""
        with self.database.transaction() as db:
            session_row = lock_session(db, ctx.session_id)
            if session_row.current_requirement_version != ctx.version:
                raise Superseded(ctx.run_id)
            return fn(db, session_row)

    def _event(
        self,
        db: Session,
        s: ConsultationSession,
        ctx: RunContext,
        type_: EventType,
        status: WorkStatus,
        team: Team | None,
        message: str,
        **kwargs: Any,
    ) -> None:
        append_event(
            db,
            s,
            type=type_,
            status=status,
            message=message,
            run_id=ctx.run_id,
            requirement_version=ctx.version,
            team=team,
            **kwargs,
        )

    def _start_task(self, ctx: RunContext, team: Team, name: str) -> TaskHandle:
        task = TaskHandle(id=str(uuid.uuid4()), team=team, name=name)

        def write(db: Session, s: ConsultationSession) -> None:
            db.add(
                AgentTask(
                    id=task.id,
                    run_id=ctx.run_id,
                    team=team.value,
                    name=name[:160],
                    status=WorkStatus.running.value,
                    attempt=1,
                    started_at=utcnow(),
                )
            )
            self._event(
                db, s, ctx, EventType.task_started, WorkStatus.running, team, f"{name} 시작"
            )

        self._guarded(ctx, write)
        return task

    def _finish_task(
        self,
        ctx: RunContext,
        task: TaskHandle,
        status: WorkStatus,
        type_: EventType,
        message: str,
        *,
        error: EventError | None = None,
        artifact: ArtifactRef | None = None,
        metrics: dict[str, float] | None = None,
        extra: Callable[[Session], None] | None = None,
    ) -> None:
        duration = elapsed_ms(task.started_ms)

        def write(db: Session, s: ConsultationSession) -> None:
            if extra:
                extra(db)
            row = db.get(AgentTask, task.id)
            assert row is not None
            row.status = status.value
            row.attempt = task.attempt
            row.finished_at = utcnow()
            row.duration_ms = duration
            if error:
                row.error_code, row.error_message = error.code, error.message[:500]
            self._event(
                db,
                s,
                ctx,
                type_,
                status,
                task.team,
                message,
                error=error,
                artifact=artifact,
                metrics={"duration_ms": float(duration), **(metrics or {})},
            )

        self._guarded(ctx, write)

    def _finish_run(
        self,
        ctx: RunContext,
        status: WorkStatus,
        type_: EventType,
        message: str,
        *,
        team: Team | None = None,
        error: EventError | None = None,
    ) -> None:
        def write(db: Session, s: ConsultationSession) -> None:
            run = db.get(WorkflowRun, ctx.run_id)
            assert run is not None
            run.status = status.value
            run.finished_at = utcnow()
            run.error_code = error.code if error else None
            total_ms = float(_ms_since(run.started_at))
            self._event(
                db,
                s,
                ctx,
                type_,
                status,
                team,
                message,
                error=error,
                metrics={"total_ms": total_ms},
            )

        self._guarded(ctx, write)

    def _attempt[T](self, ctx: RunContext, task: TaskHandle, fn: Callable[[], T]) -> T:
        """일시 오류면 정해진 횟수만큼 다시 시도하고, 그래도 안 되면 실행을 '실패(재시도 가능)'로 닫습니다."""
        while True:
            try:
                if self.hooks.fail_attempt and self.hooks.fail_attempt(task.team, task.attempt):
                    raise TransientAgentError("테스트용 일시 오류")
                return fn()
            except TransientAgentError as exc:
                if task.attempt >= self.max_attempts:
                    error = EventError(code="AGENT_UNAVAILABLE", message=str(exc), retryable=True)
                    self._finish_task(
                        ctx,
                        task,
                        WorkStatus.failed,
                        EventType.task_failed,
                        f"{task.name} 실패 — 재시도 한도를 넘었습니다",
                        error=error,
                    )
                    self._finish_run(
                        ctx,
                        WorkStatus.failed,
                        EventType.run_failed,
                        "작업이 실패했습니다. 다시 시도할 수 있습니다.",
                        error=error,
                    )
                    raise RunAborted from exc
                task.attempt += 1
                self._guarded(ctx, lambda db, s: self._record_retry(db, s, ctx, task))

    def _record_retry(
        self, db: Session, s: ConsultationSession, ctx: RunContext, task: TaskHandle
    ) -> None:
        row = db.get(AgentTask, task.id)
        assert row is not None
        row.attempt = task.attempt
        self._event(
            db,
            s,
            ctx,
            EventType.task_retrying,
            WorkStatus.running,
            task.team,
            f"{task.name} 다시 시도 ({task.attempt}/{self.max_attempts})",
        )

    def _pause(self) -> None:
        if self.delay_s > 0:
            time.sleep(self.delay_s)

    def _cancel_open_tasks(self, run_id: str) -> None:
        with self.database.transaction() as db:
            for task in db.scalars(
                select(AgentTask).where(
                    AgentTask.run_id == run_id, AgentTask.status == WorkStatus.running.value
                )
            ):
                task.status = WorkStatus.cancelled.value
                task.finished_at = utcnow()

    def _fail_unexpected(self, run_id: str, exc: Exception) -> None:
        try:
            with self.database.transaction() as db:
                run = db.get(WorkflowRun, run_id)
                if run is None or run.status not in (WorkStatus.pending, WorkStatus.running):
                    return
                s = lock_session(db, run.session_id)
                for task in db.scalars(
                    select(AgentTask).where(
                        AgentTask.run_id == run_id, AgentTask.status == WorkStatus.running.value
                    )
                ):
                    task.status = WorkStatus.failed.value
                    task.finished_at = utcnow()
                run.finished_at = utcnow()
                if s.current_requirement_version != run.requirement_version:
                    run.status = WorkStatus.superseded.value
                    return
                run.status = WorkStatus.failed.value
                run.error_code = "INTERNAL_ERROR"
                append_event(
                    db,
                    s,
                    type=EventType.run_failed,
                    status=WorkStatus.failed,
                    message="예상하지 못한 오류로 작업이 멈췄습니다. 다시 시도할 수 있습니다.",
                    run_id=run.id,
                    requirement_version=run.requirement_version,
                    error=EventError(code="INTERNAL_ERROR", message=str(exc)[:300], retryable=True),
                )
        except Exception:
            logger.exception("실행 %s 의 실패 기록 중 오류", run_id)
