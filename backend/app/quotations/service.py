"""참고 견적 조회. 견적 생성은 견적팀(app/agents/quotation.py)이 실행 중에 합니다."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.consultation.queries import latest_run
from app.contracts.schemas import QuotationItemOut, QuotationOut
from app.core.errors import NotFoundError
from app.db.models import ConsultationSession, Quotation


def current_quotation(db: Session, session_row: ConsultationSession) -> QuotationOut:
    run = latest_run(db, session_row)
    quote = None
    if run is not None:
        quote = db.scalar(
            select(Quotation)
            .where(Quotation.run_id == run.id)
            .order_by(Quotation.created_at.desc())
            .limit(1)
        )
    if quote is None:
        raise NotFoundError("현재 요구사항에 대한 견적이 아직 없습니다")
    return QuotationOut(
        id=quote.id,
        requirement_version=quote.requirement_version,
        status=quote.status,
        items=[QuotationItemOut.model_validate(item) for item in quote.items],
        subtotal=quote.subtotal,
        shipping_fee=quote.shipping_fee,
        discount=quote.discount,
        total=quote.total,
        currency=quote.currency,
        notes=quote.notes,
        valid_until=quote.valid_until,
    )
