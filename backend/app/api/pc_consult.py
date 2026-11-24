"""Catalog, RAG and approval operations for the active PC storefront."""

import asyncio
from collections.abc import Callable
from contextlib import contextmanager
from datetime import UTC, datetime
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Path, Query, Request, Response
from fastapi.responses import StreamingResponse

from app.api.pc_sessions import COOKIE, SESSION_TTL, GuestSession, GuestSessions
from app.contracts import pc_consult as c
from app.contracts.schemas import AgentEventOut, Team

PREFIX = "/api/pc-consult"
router = APIRouter(prefix=PREFIX, tags=["PC 상담"])


def _sessions(request: Request) -> GuestSessions:
    return request.app.state.pc_sessions


def _call(function: Callable, *args, **kwargs):
    from app.domains.hardware.pc_consultation.advisor import AdvisorError
    from app.domains.hardware.pc_consultation.flow import InputError
    from app.domains.hardware.pc_consultation.parts_db import PartsCatalogError

    try:
        return function(*args, **kwargs)
    except InputError as exc:
        raise HTTPException(422, str(exc)) from exc
    except (PartsCatalogError, AdvisorError) as exc:
        raise HTTPException(503, str(exc)) from exc


@contextmanager
def _operation(request, session_id, team, label, *, survey=None):
    with _sessions(request).visit(session_id, request.cookies.get(COOKIE)) as session:
        if survey is not None:
            session.check_survey(survey)
        with session.work(team, label) as validation_stage:
            yield session, validation_stage


@router.post("/sessions", response_model=c.SessionOut, status_code=201)
def create_session(request: Request, response: Response):
    session = _sessions(request).create()
    response.set_cookie(
        COOKIE,
        session.token,
        path=f"{PREFIX}/sessions/{session.log.id}",
        max_age=SESSION_TTL,
        httponly=True,
        samesite="strict",
        secure=request.url.scheme == "https",
    )
    response.headers["Cache-Control"] = "no-store"
    return c.SessionOut(session_id=session.log.id)


@router.get("/sessions/{session_id}/parts", response_model=list[c.Part])
def search_parts(
    request: Request,
    session_id: str,
    category: c.Category,
    query: Annotated[str, Query(max_length=150)] = "",
):
    from app.domains.hardware.pc_consultation import service

    with _sessions(request).visit(session_id, request.cookies.get(COOKIE)):
        return _call(service.search_parts, category, query)


@router.post("/sessions/{session_id}/plan", response_model=c.PlanOut)
def plan(request: Request, session_id: str, body: c.PlanIn):
    from app.domains.hardware.pc_consultation import service

    with _sessions(request).visit(session_id, request.cookies.get(COOKIE)) as session:
        session.log.current_requirement_version += 1
        session.survey = None
        session.design.clear()
        session.assessments.clear()
        session.candidate_explanations.clear()
        session.draft = session.draft_input = None
        with session.work(Team.consultation, "상담 조건 분석"):
            inputs = session.survey_inputs(body.survey)
            result = c.PlanOut.model_validate(_call(service.plan, inputs))
            session.design = inputs["_design"]
            session.survey = body.survey
            return result


@router.post("/sessions/{session_id}/candidates", response_model=c.CandidatesOut)
def candidates(request: Request, session_id: str, body: c.CandidatesIn):
    from app.domains.hardware.pc_consultation import service

    with _operation(request, session_id, Team.design, "부품 후보 조회", survey=body.survey) as (
        session,
        stage,
    ):
        details = {}
        result = c.CandidatesOut.model_validate(
            _call(
                service.candidates,
                {**body.model_dump(), "survey": session.survey_inputs(body.survey, body.cooling)},
                validation_stage=stage,
                explanation=details,
            )
        )
        session.candidate_explanations.pop(body.category, None)
        session.candidate_explanations[body.category] = details
        return result


@router.post("/sessions/{session_id}/validations", response_model=c.ValidationOut)
def validate(request: Request, session_id: str, body: c.SelectionIn):
    from app.domains.hardware.pc_consultation import service

    with _operation(
        request, session_id, Team.validation, "선택 부품 호환성 검사", survey=body.survey
    ) as (session, _):
        return c.ValidationOut.model_validate(
            _call(service.validate, session.survey_inputs(body.survey, body.cooling), body.selected)
        )


@router.post("/sessions/{session_id}/rebalance", response_model=c.RebalanceOut)
def rebalance(request: Request, session_id: str, body: c.RebalanceIn):
    from app.domains.hardware.pc_consultation import service

    with _operation(request, session_id, Team.design, "예산 조정안 계산", survey=body.survey) as (
        session,
        _,
    ):
        return c.RebalanceOut.model_validate(
            _call(
                service.rebalance,
                {
                    **body.model_dump(exclude={"amount"}),
                    "survey": session.survey_inputs(body.survey, body.cooling),
                },
                body.amount,
            )
        )


def _quote(
    body: c.QuoteIn, session: GuestSession, quote_id: str, created_at: datetime, validation_stage
) -> c.QuoteOut:
    from app.domains.hardware.pc_consultation import service

    data = _call(
        service.quote,
        session.survey_inputs(body.survey, body.cooling),
        body.selected,
        validation_stage=validation_stage,
    )
    return c.QuoteOut(
        **data,
        quote_id=quote_id,
        consultation_id=session.log.id,
        version=body.version,
        created_at=created_at,
        currency="KRW",
        status="DRAFT",
    )


@router.post("/sessions/{session_id}/quotes", response_model=c.QuoteOut)
def create_quote(request: Request, session_id: str, body: c.QuoteIn):
    with _sessions(request).visit(session_id, request.cookies.get(COOKIE)) as session:
        session.check_survey(body.survey)
        if session.draft and session.draft_input == body:
            if (
                session.draft.status == "DRAFT"
                and session.draft_preferences != session.candidate_preferences
            ):
                with session.work(Team.quotation, "상담 조건으로 견적 재검증") as stage:
                    checked = _quote(
                        body, session, session.draft.quote_id, session.draft.created_at, stage
                    )
                    if checked != session.draft:
                        raise HTTPException(
                            409, "견적 조건이 바뀌었습니다. 새 견적을 만들어 주세요."
                        )
                    session.draft_preferences = session.candidate_preferences.copy()
            return session.draft
        expected = session.draft.version + 1 if session.draft else 1
        if body.version != expected:
            raise HTTPException(409, "견적 버전이 변경되었습니다. 최신 견적을 확인해 주세요.")
        with session.work(Team.quotation, "현재 가격으로 견적 계산") as stage:
            draft = _quote(body, session, str(uuid4()), datetime.now(UTC), stage)
            session.draft, session.draft_input = draft, body
            session.draft_preferences = session.candidate_preferences.copy()
            return draft


@router.post("/sessions/{session_id}/quotes/{version}/confirm", response_model=c.ReceiptOut)
def confirm_quote(
    request: Request, session_id: str, version: Annotated[int, Path(gt=0)], body: c.ConfirmIn
):
    with _sessions(request).visit(session_id, request.cookies.get(COOKIE)) as session:
        draft, original = session.draft, session.draft_input
        if not draft or not original or draft.version != version or draft.quote_id != body.quote_id:
            raise HTTPException(409, "현재 견적만 승인할 수 있습니다. 최신 견적을 확인해 주세요.")
        if draft.status != "CONFIRMED":
            with session.work(Team.quotation, "견적 재검증 및 승인", final=True) as stage:
                current = _quote(original, session, draft.quote_id, draft.created_at, stage)
                if draft != current:
                    # Keep the shown draft available. A new version requires a deliberate review.
                    raise HTTPException(
                        409, "가격 또는 검증 근거가 바뀌었습니다. 새 견적을 만들어 주세요."
                    )
                validation = current.validation
                if validation.status == "FAIL" or validation.workflow_status not in {
                    None,
                    "completed",
                }:
                    raise HTTPException(
                        409, validation.workflow_reason or "검증을 마친 뒤 승인할 수 있습니다."
                    )
                if validation.status != "PASS" and not body.accept_conditions:
                    raise HTTPException(422, "조건부·미확인 호환 항목을 확인한 후 승인해 주세요.")
                draft = draft.model_copy(update={"status": "CONFIRMED"})
                session.draft = draft
        return c.ReceiptOut(quote=draft, message="현재 상담 세션에서 견적을 승인했습니다.")


@router.get("/sessions/{session_id}/messages", response_model=list[c.MessageOut])
def messages(request: Request, session_id: str):
    with _sessions(request).visit(session_id, request.cookies.get(COOKIE)) as session:
        return list(session.messages)


@router.post("/sessions/{session_id}/messages", response_model=c.ReplyOut)
def send_message(request: Request, session_id: str, body: c.MessageIn):
    from app.domains.hardware.pc_consultation import service

    with _operation(
        request, session_id, Team.consultation, "상담 근거 검색 및 답변", survey=body.survey
    ) as (session, _):
        if len(session.messages) >= 200:
            raise HTTPException(429, "이 상담의 대화 한도에 도달했습니다. 새 상담을 시작해 주세요.")
        survey = session.survey_inputs(session.survey, body.cooling) if session.survey else None
        history = [m.model_dump(mode="json") for m in session.messages[-8:]]
        from app.domains.hardware.pc_consultation.candidate_answers import answer_question

        answer = _call(answer_question, body.text, session.candidate_explanations, survey)
        if answer is None:
            answer = _call(service.chat, body.text, survey, body.selected, history)
        question = c.MessageOut(
            id=len(session.messages) + 1,
            created_at=datetime.now(UTC),
            content=body.text,
            role="user",
        )
        reply = c.MessageOut(
            id=len(session.messages) + 2,
            created_at=datetime.now(UTC),
            content=answer["text"],
            sources=answer.get("sources", []),
            role="assistant",
        )
        session.messages.extend([question, reply])
        session.candidate_preferences.update(answer.get("_preferences", ()))
        if answer.get("_preferences"):
            session.candidate_explanations.clear()
            session.assessments.clear()
        return c.ReplyOut(
            text=reply.content, sources=reply.sources, messages=list(session.messages)
        )


@router.get("/sessions/{session_id}/events", response_model=list[AgentEventOut])
def events(request: Request, session_id: str, after: Annotated[int, Query(ge=0)] = 0):
    return _sessions(request).read(session_id, request.cookies.get(COOKIE)).log.after(after)


@router.get(
    "/sessions/{session_id}/events/stream",
    response_class=StreamingResponse,
    responses={200: {"content": {"text/event-stream": {}}}},
)
async def stream(request: Request, session_id: str, after: Annotated[int, Query(ge=0)] = 0):
    store = _sessions(request)
    token = request.cookies.get(COOKIE)
    session = store.read(session_id, token)
    last_id = request.headers.get("last-event-id", "0")
    if not last_id.isascii() or not last_id.isdecimal() or len(last_id) > 12:
        raise HTTPException(422, "이벤트 순번이 올바르지 않습니다.")
    cursor = max(after, int(last_id))
    if cursor > len(session.log.events):
        raise HTTPException(409, "요청한 이벤트 순번이 이 상담의 마지막 기록을 초과합니다.")

    async def generate():
        nonlocal cursor
        yield ": connected\n\n"
        idle = 0
        while not await request.is_disconnected():
            try:
                store.read(session_id, token)
            except HTTPException:
                break
            batch = session.log.after(cursor)
            if batch:
                for event in batch:
                    yield f"id: {event.seq}\ndata: {event.model_dump_json()}\n\n"
                    cursor = event.seq
                idle = 0
            else:
                await asyncio.sleep(0.25)
                idle += 1
                if idle == 60:
                    yield ": keep-alive\n\n"
                    idle = 0

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )
