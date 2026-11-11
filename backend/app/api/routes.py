"""API 계약 v0 — 전체 목록과 설명은 docs/ARCHITECTURE.md, 실행 중 문서는 http://localhost:8000/docs

규칙
- 엔드포인트는 `def` 로 씁니다(동기 DB 사용). 실시간 스트림 하나만 `async def` 입니다.
- 기업 구분은 `X-Company-Id` 헤더입니다. 시연용 기업 전환이며 인증·권한 검사가 아닙니다.
"""

import asyncio
from collections.abc import AsyncIterator, Iterator
from typing import Annotated

from fastapi import APIRouter, Depends, Header, Query, Request, Response, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.companies.service import list_companies
from app.consultation import queries
from app.consultation.service import (
    create_session,
    get_session_for_company,
    retry_current,
    update_requirements,
)
from app.contracts.schemas import (
    AgentEventOut,
    CompanyOut,
    HealthOut,
    OrderIn,
    OrderOut,
    QuotationOut,
    RecommendationOut,
    RequirementsIn,
    RequirementsUpdateOut,
    RunOut,
    SessionOut,
)
from app.core.db import Database
from app.events.service import fetch_events, format_sse, list_events
from app.orders.service import create_order, get_order
from app.quotations.service import current_quotation
from app.workflows.runner import WorkflowRunner

router = APIRouter(prefix="/api")

CompanyId = Annotated[
    int,
    Header(alias="X-Company-Id", description="시연용 기업 전환 값입니다. 인증이 아닙니다."),
]


def get_database(request: Request) -> Database:
    return request.app.state.database


def get_runner(request: Request) -> WorkflowRunner:
    return request.app.state.runner


def get_db(request: Request) -> Iterator[Session]:
    with request.app.state.database.session() as db:
        yield db


DbSession = Annotated[Session, Depends(get_db)]
DatabaseDep = Annotated[Database, Depends(get_database)]
RunnerDep = Annotated[WorkflowRunner, Depends(get_runner)]


@router.get("/health", response_model=HealthOut, tags=["system"])
def health(request: Request, database: DatabaseDep) -> HealthOut:
    ok = database.ping()
    return HealthOut(
        status="ok" if ok else "degraded",
        mode=request.app.state.settings.mode,
        database="ok" if ok else "unreachable",
    )


@router.get("/companies", response_model=list[CompanyOut], tags=["companies"])
def get_companies(db: DbSession) -> list[CompanyOut]:
    return list_companies(db)


@router.post(
    "/sessions",
    response_model=SessionOut,
    status_code=status.HTTP_201_CREATED,
    tags=["consultation"],
)
def post_session(company_id: CompanyId, database: DatabaseDep, db: DbSession) -> SessionOut:
    session_id = create_session(database, company_id)
    return queries.session_out(db, get_session_for_company(db, session_id, company_id))


@router.get("/sessions/{session_id}", response_model=SessionOut, tags=["consultation"])
def get_session(session_id: str, company_id: CompanyId, db: DbSession) -> SessionOut:
    return queries.session_out(db, get_session_for_company(db, session_id, company_id))


@router.put(
    "/sessions/{session_id}/requirements",
    response_model=RequirementsUpdateOut,
    tags=["consultation"],
)
def put_requirements(
    session_id: str,
    body: RequirementsIn,
    company_id: CompanyId,
    database: DatabaseDep,
    runner: RunnerDep,
    db: DbSession,
) -> RequirementsUpdateOut:
    changed, run_id = update_requirements(database, session_id, company_id, body)
    if run_id is not None:
        runner.submit(run_id)
    session_row = get_session_for_company(db, session_id, company_id)
    return RequirementsUpdateOut(changed=changed, session=queries.session_out(db, session_row))


@router.post("/sessions/{session_id}/retry", response_model=RunOut, tags=["consultation"])
def post_retry(
    session_id: str,
    company_id: CompanyId,
    database: DatabaseDep,
    runner: RunnerDep,
    db: DbSession,
) -> RunOut:
    run_id = retry_current(database, session_id, company_id)
    runner.submit(run_id)
    return queries.run_out_by_id(db, run_id)


@router.get("/sessions/{session_id}/events", response_model=list[AgentEventOut], tags=["events"])
def get_events(
    session_id: str,
    company_id: CompanyId,
    db: DbSession,
    after: Annotated[int, Query(ge=0, description="이 순번 다음 이벤트부터")] = 0,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
) -> list[AgentEventOut]:
    get_session_for_company(db, session_id, company_id)
    return list_events(db, session_id, after, limit)


@router.get(
    "/sessions/{session_id}/events/stream",
    tags=["events"],
    response_class=StreamingResponse,
    responses={200: {"content": {"text/event-stream": {}}, "description": "SSE 이벤트 스트림"}},
)
async def stream_events(
    session_id: str,
    request: Request,
    database: DatabaseDep,
    company_id: Annotated[
        int, Query(description="브라우저 EventSource 는 헤더를 못 보내서 여기서는 쿼리로 받습니다")
    ],
    after: Annotated[int, Query(ge=0)] = 0,
    last_event_id: Annotated[str | None, Header(alias="Last-Event-ID")] = None,
) -> StreamingResponse:
    """실시간 이벤트(SSE). 연결이 끊겼다 다시 붙으면 브라우저가 보낸 Last-Event-ID 다음부터 다시 보냅니다."""

    def check() -> None:
        with database.session() as db:
            get_session_for_company(db, session_id, company_id)

    await run_in_threadpool(check)
    start = max(after, int(last_event_id) if last_event_id and last_event_id.isdigit() else 0)

    async def stream() -> AsyncIterator[str]:
        last = start
        idle_ticks = 0
        yield "retry: 2000\n\n"
        while not await request.is_disconnected():
            events = await run_in_threadpool(fetch_events, database, session_id, last)
            for event in events:
                last = event.seq
                yield format_sse(event)
            idle_ticks = 0 if events else idle_ticks + 1
            if idle_ticks and idle_ticks % 60 == 0:
                yield ": keep-alive\n\n"
            await asyncio.sleep(0.25)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get(
    "/sessions/{session_id}/recommendations",
    response_model=list[RecommendationOut],
    tags=["recommendations"],
)
def get_recommendations(
    session_id: str, company_id: CompanyId, db: DbSession
) -> list[RecommendationOut]:
    return queries.list_recommendations(db, get_session_for_company(db, session_id, company_id))


@router.get("/sessions/{session_id}/quotation", response_model=QuotationOut, tags=["quotations"])
def get_quotation(session_id: str, company_id: CompanyId, db: DbSession) -> QuotationOut:
    return current_quotation(db, get_session_for_company(db, session_id, company_id))


@router.post(
    "/orders",
    response_model=OrderOut,
    status_code=status.HTTP_201_CREATED,
    tags=["orders"],
    responses={200: {"model": OrderOut, "description": "같은 Idempotency-Key 로 이미 만든 주문"}},
)
def post_order(
    body: OrderIn,
    response: Response,
    company_id: CompanyId,
    database: DatabaseDep,
    idempotency_key: Annotated[
        str, Header(alias="Idempotency-Key", description="주문 요청마다 새로 만드는 고유값(8~80자)")
    ],
) -> OrderOut:
    order, created = create_order(database, company_id, body.quotation_id, idempotency_key)
    if not created:
        response.status_code = status.HTTP_200_OK
    return order


@router.get("/orders/{order_id}", response_model=OrderOut, tags=["orders"])
def get_order_by_id(order_id: str, company_id: CompanyId, db: DbSession) -> OrderOut:
    return get_order(db, company_id, order_id)
