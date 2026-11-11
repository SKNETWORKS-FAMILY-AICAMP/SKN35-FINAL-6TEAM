"""설계·분석팀: 상품을 찾고 점수를 매겨 후보를 냅니다.

지금: DB 조회 + 도메인 팩 점수(일반 코드). LLM 을 쓰지 않습니다.
나중: 후보 비교 설명 문장만 LLM 에 맡기는 것을 검토합니다(검색·필터·계산은 코드 유지).
"""

from dataclasses import dataclass

from app.catalog.records import ProductRecord
from app.companies.policy import CompanyPolicy
from app.domains.base import DomainPack, Preferences


@dataclass(frozen=True)
class Candidate:
    product: ProductRecord
    score: float
    reasons: list[str]


def rank_candidates(
    products: list[ProductRecord],
    product_types: list[str],
    budget_max: int,
    prefs: Preferences,
    policy: CompanyPolicy,
    pack: DomainPack,
) -> list[Candidate]:
    """요청한 상품 유형마다 고르게 후보를 뽑습니다. 기업이 취급하지 않는 유형은 뺍니다."""
    wanted = [t for t in product_types if t in policy.supported_product_types]
    if not wanted:
        return []
    per_type = max(2, policy.max_candidates // len(wanted))

    picked: list[Candidate] = []
    for product_type in wanted:
        scored: list[Candidate] = []
        for product in products:
            if product.product_type != product_type:
                continue
            result = pack.score(product, budget_max, prefs)
            if result is not None:
                scored.append(Candidate(product, result.score, result.reasons))
        scored.sort(key=lambda c: (-c.score, c.product.price_amount or 0, c.product.sku))
        picked.extend(scored[:per_type])

    picked.sort(key=lambda c: (-c.score, c.product.sku))
    return picked
