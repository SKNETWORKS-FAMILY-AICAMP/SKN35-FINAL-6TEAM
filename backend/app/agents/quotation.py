"""견적·주문팀: 검증을 통과한 후보로 참고 견적을 만듭니다.

- 요청한 상품 유형마다 1개씩 고르고, 총액이 예산 안인 조합 중 점수 합이 가장 높은 것을 씁니다.
- 가격이 미확인인 상품만 남으면 견적을 만들지 않습니다(가격을 지어내지 않음).
- 배송비 · 할인 · 유효기간은 기업 정책을 따릅니다.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta
from itertools import product as combinations_of

from app.agents.design import Candidate
from app.companies.policy import CompanyPolicy


class QuotationError(Exception):
    def __init__(self, code: str, message: str, retryable: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


@dataclass(frozen=True)
class QuoteDraft:
    items: list[dict]
    subtotal: int
    shipping_fee: int
    discount: int
    total: int
    currency: str
    notes: list[str]
    valid_until: datetime


def build_quote(
    validated: list[Candidate],
    product_types: list[str],
    budget_max: int,
    policy: CompanyPolicy,
    now: datetime,
) -> QuoteDraft:
    wanted = [t for t in product_types if t in policy.supported_product_types]
    groups: list[list[Candidate]] = []
    for product_type in wanted:
        group = [c for c in validated if c.product.product_type == product_type]
        if not group:
            raise QuotationError(
                "TYPE_NOT_COVERED", f"'{product_type}' 후보 중 검증을 통과한 것이 없습니다."
            )
        priced = [c for c in group if c.product.has_usable_price]
        if not priced:
            raise QuotationError(
                "PRICE_UNCONFIRMED",
                f"'{product_type}' 후보가 모두 가격 미확인이라 견적을 만들 수 없습니다. 판매처 확인이 필요합니다.",
            )
        groups.append(priced)
    if not groups:
        raise QuotationError("NO_VALIDATED_CANDIDATE", "검증을 통과한 후보가 없습니다.")

    best: tuple[Candidate, ...] | None = None
    best_score = float("-inf")
    for combo in combinations_of(*groups):
        total = sum(c.product.price_amount or 0 for c in combo)
        if total > budget_max:
            continue
        score = sum(c.score for c in combo)
        if score > best_score:
            best, best_score = combo, score
    if best is None:
        raise QuotationError(
            "OVER_BUDGET", "검증된 후보를 조합하면 예산을 넘습니다. 예산이나 유형을 바꿔 주세요."
        )

    items = [
        {
            "sku": c.product.sku,
            "product_type": c.product.product_type,
            "brand": c.product.brand,
            "model_name": c.product.model_name,
            "unit_price": c.product.price_amount or 0,
            "quantity": 1,
            "line_total": c.product.price_amount or 0,
            "data_status": c.product.data_status,
        }
        for c in best
    ]
    subtotal = sum(item["line_total"] for item in items)
    discount = round(subtotal * policy.discount_rate)
    free = policy.free_shipping_over is not None and subtotal >= policy.free_shipping_over
    shipping_fee = 0 if free else policy.shipping_fee
    notes = ["참고 견적입니다. 실제 판매가·재고·배송 일정은 확인되지 않았습니다."]
    if any(c.product.data_status == "test" for c in best):
        notes.append("테스트 데이터(가상 상품)로 만든 견적입니다.")
    return QuoteDraft(
        items=items,
        subtotal=subtotal,
        shipping_fee=shipping_fee,
        discount=discount,
        total=subtotal - discount + shipping_fee,
        currency="KRW",
        notes=notes,
        valid_until=now + timedelta(days=policy.quote_valid_days),
    )
