"""엔진이 다루는 공통 상품 형식.

기업마다 상품 데이터 모양이 달라도, 적재 어댑터(app/catalog/loaders.py)가 이 형식으로 바꿔 넣습니다.
엔진(app/agents)은 이 형식만 압니다.
"""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

PriceStatus = Literal["confirmed", "unconfirmed", "test"]
DataStatus = Literal["verified", "unverified", "test"]


class ProductRecord(BaseModel):
    model_config = ConfigDict(frozen=True, from_attributes=True)

    id: int | None = None
    sku: str = Field(min_length=1, max_length=64)
    product_type: str = Field(min_length=1, max_length=30)
    brand: str = Field(min_length=1, max_length=80)
    model_name: str = Field(min_length=1, max_length=160)
    price_amount: int | None = Field(default=None, ge=0)
    currency: str = "KRW"
    price_status: PriceStatus
    data_status: DataStatus
    source_url: str | None = None
    source_note: str = ""
    attributes: dict[str, Any] = Field(default_factory=dict)

    @property
    def has_usable_price(self) -> bool:
        """견적에 쓸 수 있는 가격인지. 미확인 가격으로는 견적을 만들지 않습니다."""
        return self.price_amount is not None and self.price_status != "unconfirmed"

    def snapshot(self) -> dict[str, Any]:
        return self.model_dump(mode="json", exclude={"id"})
