"""기업별 판매 정책 형식.

같은 엔진이라도 기업마다 취급 상품 · 배송비 · 할인 · 견적 유효기간이 다릅니다.
정책 값은 data/fixtures/companies.json 에 있고, 적재될 때 이 형식으로 검사합니다.
"""

from pydantic import BaseModel, ConfigDict, Field


class CompanyPolicy(BaseModel):
    model_config = ConfigDict(extra="forbid")

    supported_product_types: list[str] = Field(min_length=1)
    shipping_fee: int = Field(ge=0)
    free_shipping_over: int | None = Field(default=None, ge=0)
    discount_rate: float = Field(ge=0, le=0.5)
    quote_valid_days: int = Field(ge=1, le=90)
    max_candidates: int = Field(default=6, ge=1, le=20)
