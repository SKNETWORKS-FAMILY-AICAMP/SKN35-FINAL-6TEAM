"""하드웨어 도구 API 의 도메인 쪽 처리 — 요청 값 + 기업 카탈로그로 계산 함수를 부릅니다.

API 계층(app/api/routes.py)이 DB 에서 그 기업의 상품만 읽어 넘겨 주고, 여기서는 DB 를 직접 보지 않습니다.
"""

from typing import cast

from app.catalog.records import ProductRecord
from app.contracts.schemas import (
    CloudCompareIn,
    CloudCompareOut,
    DiagnoseIn,
    DiagnoseOut,
    LocalOptionOut,
    VramEstimateIn,
    VramEstimateOut,
)
from app.domains.hardware.attributes import PRODUCT_TYPE_LABELS
from app.domains.hardware.cloud import CloudPriceSheet, cheapest_local_option, compare_cloud
from app.domains.hardware.diagnosis import DeviceType, OwnedDevice, diagnose
from app.domains.hardware.sizing import estimate_vram

OWNED_DEVICE_TYPES = ("laptop", "desktop")
CATALOG_TYPES = tuple(PRODUCT_TYPE_LABELS)  # 도구가 기업 카탈로그에서 읽는 상품 유형 전부


class OwnedProductNotFound(LookupError):
    """보유 장비로 지정한 상품코드가 이 기업 카탈로그에 없습니다(→ 404)."""


def estimate(target: VramEstimateIn) -> VramEstimateOut:
    return estimate_vram(target.model_params_b, target.precision, target.workload)


def resolve_owned_device(body: DiagnoseIn, products: list[ProductRecord]) -> OwnedDevice:
    base = OwnedDevice()
    if body.owned_sku is not None:
        product = next((p for p in products if p.sku == body.owned_sku), None)
        if product is None:
            raise OwnedProductNotFound(f"이 기업 카탈로그에 없는 상품코드입니다: {body.owned_sku}")
        if product.product_type not in OWNED_DEVICE_TYPES:
            raise ValueError("보유 장비 진단은 노트북 · 데스크톱 상품만 지원합니다")
        base = OwnedDevice.from_attributes(
            cast(DeviceType, product.product_type), product.attributes
        )
    device = base.overridden(
        device_type=body.device_type,
        ram_gb=body.ram_gb,
        ram_onboard=body.ram_onboard,
        ram_max_gb=body.ram_max_gb,
        ram_slots_free=body.ram_slots_free,
        storage_gb=body.storage_gb,
        m2_slots_free=body.m2_slots_free,
        gpu_vram_gb=body.gpu_vram_gb,
    )
    if device.device_type is None:
        raise ValueError("device_type(laptop · desktop) 이나 owned_sku 중 하나가 필요합니다")
    return device


def diagnose_request(body: DiagnoseIn, products: list[ProductRecord]) -> DiagnoseOut:
    return diagnose(
        resolve_owned_device(body, products), estimate(body.target), body.needed_storage_gb
    )


def cloud_compare_request(
    body: CloudCompareIn, products: list[ProductRecord], sheet: CloudPriceSheet
) -> CloudCompareOut:
    vram = estimate(body.target)
    if body.local_price_krw is not None:
        local: LocalOptionOut | None = LocalOptionOut(
            source="input",
            sku=None,
            label="직접 입력한 장비",
            price_krw=body.local_price_krw,
            data_status="unverified",
        )
    else:
        local = cheapest_local_option(products, vram.required_vram_gb)
    return compare_cloud(vram, body.weekly_hours, sheet, local)
