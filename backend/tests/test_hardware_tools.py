"""DB 없이 도는 테스트: VRAM 추정 · 보유 장비 진단 · 클라우드 비교 · 모델 크기 → 설계팀 조건."""

import pytest

from app.catalog.records import ProductRecord
from app.contracts.schemas import (
    CloudCompareIn,
    DiagnoseIn,
    Precision,
    VramEstimateIn,
    Workload,
)
from app.core.config import Settings
from app.domains.hardware.cloud import load_cloud_prices
from app.domains.hardware.pack import HardwarePack
from app.domains.hardware.sizing import (
    estimate_vram,
    required_ram_gb,
    required_storage_gb,
)
from app.domains.hardware.tools import (
    OwnedProductNotFound,
    cloud_compare_request,
    diagnose_request,
)
from app.seed import load_catalog, read_seeds

FIXTURES = Settings().fixtures_dir
PACK = HardwarePack()


def _catalog(slug: str) -> list[ProductRecord]:
    seed = next(s for s in read_seeds(FIXTURES) if s.slug == slug)
    return load_catalog(seed, FIXTURES)


@pytest.mark.parametrize(
    ("params_b", "precision", "workload", "expected_gb"),
    [
        (7, Precision.int4, Workload.inference, 4.2),  # 7 × 0.5 = 3.5 × 1.2
        (7, Precision.int4, Workload.lora, 7.7),  # 3.5 × 1.2 + 7 × 0.5
        (7, Precision.int8, Workload.inference, 8.4),  # 7 × 1 × 1.2
        (7, Precision.fp16, Workload.inference, 16.8),  # 7 × 2 × 1.2
        (13, Precision.fp16, Workload.lora, 37.7),  # 26 × 1.2 + 6.5
        (70, Precision.int4, Workload.inference, 42.0),
    ],
)
def test_vram_formula(
    params_b: float, precision: Precision, workload: Workload, expected_gb: float
) -> None:
    estimate = estimate_vram(params_b, precision, workload)
    assert estimate.required_vram_gb == expected_gb
    assert estimate.assumptions, "가정은 항상 함께 돌려줍니다"
    assert f"{expected_gb:g}GB" in estimate.formula


def test_ram_and_storage_rules() -> None:
    small = estimate_vram(7, Precision.int4)
    big = estimate_vram(7, Precision.fp16)
    assert required_ram_gb(small) == 16  # 최소 16GB
    assert required_ram_gb(big) == 32  # 16.8GB 이상인 표준 용량
    assert required_storage_gb(small) == 128  # 7 × 2 × 2 + 100


def test_model_size_becomes_design_filter() -> None:
    """모델 크기를 주면 사용 목적으로 어림한 VRAM(16GB) 대신 계산한 값(7.7 → 8GB)을 씁니다."""
    coarse = PACK.derive_preferences("LLM 파인튜닝")
    assert coarse["min_vram_gb"] == 16
    precise = PACK.derive_preferences(
        "LLM 파인튜닝", {"model_params_b": 7, "precision": "int4", "workload": "lora"}
    )
    assert precise["min_vram_gb"] == 8
    assert precise["min_ram_gb"] == 32  # 사용 목적 규칙은 그대로


def test_model_preferences_are_validated() -> None:
    with pytest.raises(ValueError, match="precision"):
        PACK.derive_preferences("", {"model_params_b": 7, "precision": "int3"})
    with pytest.raises(ValueError, match="model_params_b"):
        PACK.derive_preferences("", {"precision": "int4"})
    with pytest.raises(ValueError, match="model_params_b"):
        PACK.derive_preferences("", {"model_params_b": True})


def test_laptop_without_enough_vram_needs_new_device() -> None:
    result = diagnose_request(
        DiagnoseIn(
            device_type="laptop",
            ram_gb=16,
            ram_onboard=True,
            storage_gb=512,
            gpu_vram_gb=8,
            target=VramEstimateIn(model_params_b=7, precision=Precision.fp16),
        ),
        [],
    )
    assert result.verdict == "new_device_needed"
    assert result.verdict_label == "새 장비 필요"
    status = {item.component: item.status for item in result.items}
    assert status == {"vram": "new_device", "ram": "new_device", "storage": "ok"}
    assert any("노트북" in reason for reason in result.reasons)


def test_desktop_can_be_upgraded() -> None:
    result = diagnose_request(
        DiagnoseIn(
            device_type="desktop",
            ram_gb=16,
            ram_onboard=False,
            ram_max_gb=128,
            ram_slots_free=2,
            storage_gb=100,
            m2_slots_free=1,
            gpu_vram_gb=8,
            target=VramEstimateIn(model_params_b=13, precision=Precision.int4, workload="lora"),
        ),
        [],
    )
    status = {item.component: item.status for item in result.items}
    assert status == {"vram": "upgrade", "ram": "ok", "storage": "upgrade"}
    assert result.verdict == "upgrade_sufficient"
    assert result.estimate.required_vram_gb == 14.3


def test_unknown_expandability_asks_to_check() -> None:
    result = diagnose_request(
        DiagnoseIn(
            device_type="laptop",
            ram_gb=8,
            storage_gb=512,
            gpu_vram_gb=12,
            target=VramEstimateIn(model_params_b=7, precision=Precision.int4),
        ),
        [],
    )
    ram = next(item for item in result.items if item.component == "ram")
    assert ram.status == "unknown" and "온보드" in ram.detail
    assert result.verdict == "needs_check"


def test_owned_sku_uses_catalog_spec_and_overrides() -> None:
    catalog = _catalog("public-demo")
    target = VramEstimateIn(model_params_b=7, precision=Precision.int4, workload=Workload.lora)
    owned = diagnose_request(DiagnoseIn(owned_sku="PUB-LT-002", target=target), catalog)
    assert owned.device_type == "laptop"
    assert owned.verdict == "no_change"  # VRAM 8GB ≥ 7.7GB, 램 32GB ≥ 16GB

    # 온보드 램 노트북(최대 16GB)에 더 큰 모델 → 램 증설 불가
    thin = diagnose_request(
        DiagnoseIn(owned_sku="PUB-LT-001", target=VramEstimateIn(model_params_b=7)), catalog
    )
    ram = next(item for item in thin.items if item.component == "ram")
    assert ram.status == "new_device" and "온보드" in ram.detail

    # 직접 준 값이 카탈로그 값보다 우선
    upgraded = diagnose_request(
        DiagnoseIn(owned_sku="PUB-LT-002", gpu_vram_gb=4, target=target), catalog
    )
    assert upgraded.verdict == "new_device_needed"


def test_owned_sku_errors() -> None:
    target = VramEstimateIn(model_params_b=7)
    with pytest.raises(OwnedProductNotFound):
        diagnose_request(DiagnoseIn(owned_sku="A-NB-1002", target=target), _catalog("public-demo"))
    with pytest.raises(ValueError, match="device_type"):
        diagnose_request(DiagnoseIn(ram_gb=16, target=target), [])
    with pytest.raises(ValueError, match="노트북"):
        diagnose_request(
            DiagnoseIn(owned_sku="PUB-GPU-001", target=target), _catalog("public-demo")
        )


def test_cloud_price_fixture_is_virtual_test_data() -> None:
    sheet = load_cloud_prices(FIXTURES)
    assert sheet.data_status == "test"
    assert all("(가상)" in offer.provider for offer in sheet.offers)


def test_cloud_compare_breakeven_with_catalog_price() -> None:
    sheet = load_cloud_prices(FIXTURES)
    result = cloud_compare_request(
        CloudCompareIn(target=VramEstimateIn(model_params_b=7), weekly_hours=10),
        _catalog("public-demo"),
        sheet,
    )
    # 16.8GB 이상 중 가장 싼 견본: 하늘GPU(가상) H24 시간당 990원
    assert result.offer is not None and result.offer.gpu_name == "가상 H24"
    assert result.monthly_cloud_cost_krw == round(990 * 10 * 52 / 12)
    # 카탈로그에서 VRAM 16.8GB 이상 중 가장 싼 것: 그래픽카드 G90 24GB 2,390,000원
    assert result.local_option is not None and result.local_option.sku == "PUB-GPU-004"
    assert result.breakeven_months == round(2_390_000 / result.monthly_cloud_cost_krw, 1)
    assert result.is_test_data is True


def test_cloud_compare_without_local_price_is_unconfirmed() -> None:
    sheet = load_cloud_prices(FIXTURES)
    result = cloud_compare_request(
        CloudCompareIn(target=VramEstimateIn(model_params_b=70), weekly_hours=5), [], sheet
    )
    assert result.local_option is None and result.breakeven_months is None
    assert "가격 미확인" in result.summary

    huge = cloud_compare_request(
        CloudCompareIn(target=VramEstimateIn(model_params_b=200), weekly_hours=5), [], sheet
    )
    assert huge.offer is None and huge.monthly_cloud_cost_krw is None
