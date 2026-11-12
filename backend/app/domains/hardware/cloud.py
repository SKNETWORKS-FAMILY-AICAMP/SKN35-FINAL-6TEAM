"""로컬 장비 대 클라우드 GPU 비용 비교 — 손익분기 개월 수.

    월 클라우드 비용 = 시간당 가격 × 주당 사용 시간 × 52주 ÷ 12개월
    손익분기(개월)   = 로컬 장비 가격 ÷ 월 클라우드 비용

- 클라우드 가격은 `data/fixtures/cloud_gpu_prices.json` 의 **가상 공급자 · 가상 가격(테스트 데이터)** 입니다.
  실제 가격을 쓰려면 이용 허락된 자료로 바꾸고 data_status 를 바꿉니다(가격을 지어내지 않음).
- 필요 VRAM 이상인 상품 중 시간당 가격이 가장 싼 것을 고릅니다.
- 전기료 · 감가상각 · 유지보수 · 데이터 전송료는 넣지 않았습니다(가정에 표시).
"""

import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.catalog.records import ProductRecord
from app.contracts.schemas import (
    CloudCompareOut,
    CloudOfferOut,
    LocalOptionOut,
    VramEstimateOut,
)
from app.domains.hardware.attributes import PRODUCT_TYPE_LABELS
from app.domains.hardware.sizing import describe

CLOUD_PRICES_FILE = "cloud_gpu_prices.json"
WEEKS_PER_MONTH = 52 / 12
LOCAL_CANDIDATE_TYPES = ("gpu", "desktop", "laptop")

ASSUMPTIONS = [
    "클라우드 공급자 · 가격은 가상 견본(테스트 데이터)입니다.",
    "월 비용 = 시간당 가격 × 주당 사용 시간 × 52주 ÷ 12개월.",
    "전기료 · 감가상각 · 유지보수 · 데이터 전송료는 넣지 않았습니다.",
]


class CloudOffer(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    provider: str = Field(min_length=1, max_length=80)
    gpu_name: str = Field(min_length=1, max_length=80)
    vram_gb: int = Field(ge=1, le=1024)
    price_per_hour_krw: int = Field(ge=1)


class CloudPriceSheet(BaseModel):
    model_config = ConfigDict(extra="forbid")

    description: str = Field(alias="_설명")
    currency: Literal["KRW"]
    data_status: Literal["verified", "unverified", "test"]
    offers: list[CloudOffer] = Field(min_length=1)


def load_cloud_prices(fixtures_dir: Path) -> CloudPriceSheet:
    raw = json.loads((fixtures_dir / CLOUD_PRICES_FILE).read_text(encoding="utf-8"))
    return CloudPriceSheet.model_validate(raw)


def _vram_of(product: ProductRecord) -> float | None:
    for key in ("vram_gb", "gpu_vram_gb"):
        if key in product.attributes:
            return float(product.attributes[key])
    return None


def cheapest_local_option(
    products: list[ProductRecord], required_vram_gb: float
) -> LocalOptionOut | None:
    """카탈로그에서 VRAM 조건을 넘고 가격이 확인된(또는 테스트) 상품 중 가장 싼 것."""
    usable = [
        p
        for p in products
        if p.product_type in LOCAL_CANDIDATE_TYPES
        and p.has_usable_price
        and (_vram_of(p) or 0) >= required_vram_gb
    ]
    if not usable:
        return None
    best = min(usable, key=lambda p: (p.price_amount or 0, p.sku))
    kind = PRODUCT_TYPE_LABELS.get(best.product_type, best.product_type)
    note = " — 장착할 데스크톱이 따로 있어야 합니다" if best.product_type == "gpu" else ""
    return LocalOptionOut(
        source="catalog",
        sku=best.sku,
        label=f"{kind} {best.brand} {best.model_name}{note}",
        price_krw=best.price_amount or 0,
        data_status=best.data_status,
    )


def compare_cloud(
    estimate: VramEstimateOut,
    weekly_hours: float,
    sheet: CloudPriceSheet,
    local: LocalOptionOut | None,
) -> CloudCompareOut:
    need = estimate.required_vram_gb
    fitting = [o for o in sheet.offers if o.vram_gb >= need]
    offer = min(fitting, key=lambda o: (o.price_per_hour_krw, o.vram_gb, o.provider), default=None)

    parts = [f"{describe(estimate)} — 필요 VRAM 약 {need:g}GB."]
    monthly: int | None = None
    offer_out: CloudOfferOut | None = None
    if offer is None:
        parts.append("조건을 만족하는 클라우드 GPU 견본이 없습니다.")
    else:
        monthly = round(offer.price_per_hour_krw * weekly_hours * WEEKS_PER_MONTH)
        offer_out = CloudOfferOut(**offer.model_dump(), data_status=sheet.data_status)
        parts.append(
            f"클라우드 {offer.provider} {offer.gpu_name}({offer.vram_gb}GB) 시간당"
            f" {offer.price_per_hour_krw:,}원 × 주 {weekly_hours:g}시간 ≈ 월 {monthly:,}원."
        )

    breakeven: float | None = None
    if local is None:
        parts.append("로컬 장비 가격 미확인 — 손익분기를 계산하지 않았습니다.")
    elif monthly:
        breakeven = round(local.price_krw / monthly, 1)
        parts.append(
            f"로컬 {local.label} {local.price_krw:,}원 기준 약 {breakeven:g}개월 넘게 쓰면 로컬이 더 쌉니다."
        )

    return CloudCompareOut(
        estimate=estimate,
        weekly_hours=weekly_hours,
        offer=offer_out,
        monthly_cloud_cost_krw=monthly,
        local_option=local,
        breakeven_months=breakeven,
        summary=" ".join(parts),
        assumptions=list(ASSUMPTIONS),
        is_test_data=sheet.data_status == "test"
        or (local is not None and local.data_status == "test"),
    )
