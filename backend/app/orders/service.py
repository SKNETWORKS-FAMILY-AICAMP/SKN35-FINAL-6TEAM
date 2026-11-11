"""가상 주문 만들기 — 중복 요청 방지.

- 요청마다 `Idempotency-Key` 헤더가 필요합니다. 같은 키로 다시 보내면 새로 만들지 않고 처음 주문을 돌려줍니다
  (버튼을 두 번 누르거나 네트워크가 재전송해도 주문은 1건).
- DB 에도 (company_id, idempotency_key) 유니크 제약이 있어 동시에 들어와도 1건만 남습니다.
- 요구사항이 바뀐 뒤의 옛 견적으로는 주문할 수 없습니다(409).
"""

import uuid

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.contracts.schemas import ArtifactKind, ArtifactRef, EventType, OrderOut, Team, WorkStatus
from app.core.db import Database
from app.core.errors import ConflictError, InvalidInputError, NotFoundError
from app.db.models import Order, Quotation
from app.events.service import append_event, lock_session


def _find(db: Session, company_id: int, key: str) -> Order | None:
    return db.scalar(
        select(Order).where(Order.company_id == company_id, Order.idempotency_key == key)
    )


def _validate_key(key: str) -> str:
    key = key.strip()
    if not 8 <= len(key) <= 80:
        raise InvalidInputError("Idempotency-Key 는 8~80자여야 합니다")
    return key


def create_order(
    database: Database, company_id: int, quotation_id: str, idempotency_key: str
) -> tuple[OrderOut, bool]:
    """(주문, 새로 만들었는지) 를 돌려줍니다."""
    key = _validate_key(idempotency_key)
    try:
        with database.transaction() as db:
            quote = db.get(Quotation, quotation_id)
            if quote is None:
                raise NotFoundError("견적을 찾을 수 없습니다")
            session_row = lock_session(db, quote.session_id)
            if session_row.company_id != company_id:
                raise NotFoundError("견적을 찾을 수 없습니다")

            existing = _find(db, company_id, key)
            if existing is not None:
                if existing.quotation_id != quotation_id:
                    raise ConflictError(
                        "같은 Idempotency-Key 가 다른 견적의 주문에 이미 쓰였습니다"
                    )
                return OrderOut.model_validate(existing), False

            if quote.requirement_version != session_row.current_requirement_version:
                raise ConflictError(
                    "요구사항이 바뀌어 이 견적은 최신이 아닙니다. 새 견적으로 주문해 주세요"
                )

            order = Order(
                id=str(uuid.uuid4()),
                company_id=company_id,
                session_id=session_row.id,
                quotation_id=quote.id,
                idempotency_key=key,
                status="virtual_created",
                total=quote.total,
            )
            db.add(order)
            db.flush()
            append_event(
                db,
                session_row,
                type=EventType.order_created,
                status=WorkStatus.completed,
                team=Team.quotation,
                message=f"가상 주문을 만들었습니다 ({quote.total:,}원)",
                requirement_version=quote.requirement_version,
                artifact=ArtifactRef(kind=ArtifactKind.order, id=order.id),
            )
            return OrderOut.model_validate(order), True
    except IntegrityError:
        # 아주 드물게 두 요청이 동시에 넣으려 할 때 — 먼저 들어간 주문을 돌려줍니다.
        with database.session() as db:
            existing = _find(db, company_id, key)
            if existing is None:
                raise
            return OrderOut.model_validate(existing), False


def get_order(db: Session, company_id: int, order_id: str) -> OrderOut:
    order = db.get(Order, order_id)
    if order is None or order.company_id != company_id:
        raise NotFoundError("주문을 찾을 수 없습니다")
    return OrderOut.model_validate(order)
