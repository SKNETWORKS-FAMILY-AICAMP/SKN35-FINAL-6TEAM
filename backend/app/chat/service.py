"""채팅 상담 — 메시지 하나를 한 트랜잭션으로 처리합니다(공통 엔진: 도메인 지식은 도메인 팩에).

1. 세션 행을 잠급니다(`lock_session` — 이벤트 순번 · 요구사항 버전과 같은 잠금).
2. 고객 메시지를 발화 이해(NLU: 의도 + 슬롯)하고 저장합니다. 선택지를 눌렀으면 그 값을 그대로 씁니다.
3. 이 세션의 지난 대화에서 모은 슬롯에 이번 슬롯을 덮어 합칩니다(뒤에 말한 값이 우선).
   이번 메시지의 의도가 other 면(예: 되물음에 '200만 원' 만 답함) 직전 의도를 이어 갑니다.
4. 도메인 팩이 다음 답을 정합니다 — 빠진 조건 되묻기 · 진단 · 비교 · 요구사항 확정.
5. 요구사항이 확정되면 화면 입력(PUT)과 같은 `apply_requirements` 로 새 버전 + 새 실행을 만듭니다.
   진행 중이던 옛 실행은 superseded 로 닫히고, 늦게 끝나도 결과를 저장하지 못합니다(오래된 결과 차단).
6. 상담 직원 답을 저장하고 커밋합니다. 새 실행은 커밋 뒤 라우터가 실행기에 맡깁니다.
"""

from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.catalog.repository import list_products
from app.companies.service import get_company, load_policy
from app.consultation.service import apply_requirements
from app.contracts.schemas import ChatMessageIn, ChatMessageOut, ChatTurnOut, NluOut
from app.core.db import Database
from app.core.errors import InvalidInputError, NotFoundError
from app.db.models import ChatMessage, ConsultationSession
from app.domains import get_pack
from app.domains.base import DialogueContext, DomainPack
from app.events.service import SessionNotFound, lock_session
from app.nlu.base import Slots
from app.quotations.service import current_quotation

USER, ASSISTANT = "user", "assistant"
INTENT_SLOT = "intent"
FALLBACK_INTENT = "other"


def to_message_out(row: ChatMessage) -> ChatMessageOut:
    return ChatMessageOut(
        id=row.id,
        session_id=row.session_id,
        role=row.role,
        content=row.content,
        quick_replies=row.quick_replies,
        nlu=NluOut.model_validate(row.nlu) if row.nlu else None,
        created_at=row.created_at,
    )


def _user_history(db: Session, session_row: ConsultationSession) -> list[ChatMessage]:
    return list(
        db.scalars(
            select(ChatMessage)
            .where(
                ChatMessage.company_id == session_row.company_id,
                ChatMessage.session_id == session_row.id,
                ChatMessage.role == USER,
            )
            .order_by(ChatMessage.id)
        )
    )


def _apply_turn(state: tuple[str, Slots], row: ChatMessage, pack: DomainPack) -> tuple[str, Slots]:
    """고객 메시지 하나를 대화 상태(의도, 슬롯)에 반영합니다."""
    intent, slots = state
    nlu = row.nlu or {}
    slots = {**slots, **nlu.get("slots", {})}
    if nlu.get("intent", FALLBACK_INTENT) != FALLBACK_INTENT:
        intent = nlu["intent"]
    for chosen in row.quick_replies:
        slot, value = chosen.get("slot"), chosen.get("value")
        if slot == INTENT_SLOT and value in pack.intent_labels():
            intent = value
        elif slot and value is not None:
            slots[slot] = pack.parse_slot_value(slot, value)
    return intent, slots


def _has_quotation(db: Session, session_row: ConsultationSession) -> bool:
    try:
        current_quotation(db, session_row)
    except NotFoundError:
        return False
    return True


def post_message(
    database: Database,
    session_id: str,
    company_id: int,
    body: ChatMessageIn,
    fixtures_dir: Path,
) -> tuple[ChatTurnOut, str | None]:
    """(대화 한 턴, 새 실행 id) 를 돌려줍니다. 새 실행은 커밋 뒤 실행기에 맡깁니다."""
    with database.transaction() as db:
        session_row = lock_session(db, session_id)
        if session_row.company_id != company_id:
            raise SessionNotFound(session_id)
        company = get_company(db, company_id)
        pack = get_pack(company.domain)

        chosen: list[dict[str, str]] = []
        if body.quick_reply is not None:
            slot, value = body.quick_reply.slot, body.quick_reply.value
            try:
                if slot == INTENT_SLOT:
                    if value not in pack.intent_labels():
                        raise ValueError(f"모르는 의도입니다: {value}")
                else:
                    pack.parse_slot_value(slot, value)
            except ValueError as exc:
                raise InvalidInputError(str(exc)) from exc
            chosen = [{"label": body.text, "slot": slot, "value": value}]

        nlu = pack.nlu().parse(body.text)
        user_row = ChatMessage(
            company_id=company_id,
            session_id=session_id,
            role=USER,
            content=body.text,
            quick_replies=chosen,
            nlu=nlu.to_json(),
        )
        db.add(user_row)
        db.flush()

        state: tuple[str, Slots] = (FALLBACK_INTENT, {})
        for row in _user_history(db, session_row):  # 방금 넣은 메시지까지 포함
            state = _apply_turn(state, row, pack)
        intent, slots = state

        reply = pack.respond(
            DialogueContext(
                intent=intent,
                slots=slots,
                supported_product_types=load_policy(company).supported_product_types,
                has_quotation=_has_quotation(db, session_row),
                catalog=lambda: list_products(db, company_id, list(pack.product_types())),
                fixtures_dir=fixtures_dir,
            )
        )

        changed, run_id, text = False, None, reply.text
        if reply.requirements is not None:
            changed, run_id = apply_requirements(db, session_row, reply.requirements)
            if not changed:
                text += " (이전과 같은 조건이라 다시 실행하지 않았어요.)"

        assistant_row = ChatMessage(
            company_id=company_id,
            session_id=session_id,
            role=ASSISTANT,
            content=text,
            quick_replies=[chip.model_dump(mode="json") for chip in reply.quick_replies],
            nlu=None,
        )
        db.add(assistant_row)
        db.flush()
        turn = ChatTurnOut(
            user_message=to_message_out(user_row),
            assistant_message=to_message_out(assistant_row),
            requirements_changed=changed,
            run_id=run_id,
            requirement_version=session_row.current_requirement_version,
        )
    return turn, run_id


def list_messages(db: Session, session_row: ConsultationSession) -> list[ChatMessageOut]:
    rows = db.scalars(
        select(ChatMessage)
        .where(
            ChatMessage.company_id == session_row.company_id,
            ChatMessage.session_id == session_row.id,
        )
        .order_by(ChatMessage.id)
    )
    return [to_message_out(row) for row in rows]
