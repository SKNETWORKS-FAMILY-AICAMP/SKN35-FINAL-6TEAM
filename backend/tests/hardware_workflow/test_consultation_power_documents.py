"""Exact SKU matching and independent case/stock power checks."""

from copy import deepcopy

import pytest


def build():
    return {
        "gpu": dict(
            id=1,
            name="Zotac GAMING Twin Edge · GeForce RTX 3060 12GB",
            brand="Zotac",
            source_key="docyx:f9039c30cb23d1ae258bd6f637c65e3f72fdac360dcdfe550e47fe5d0805d8b9",
            model_number=None,
            power_draw_w=170,
            specs=dict(
                chipset="GeForce RTX 3060 12GB", length_mm=224, vram_gb=12, boost_clock_mhz=1777
            ),
        ),
        "cpu": dict(
            id=2,
            name="AMD Ryzen 5 7600",
            brand="AMD",
            model_number="Ryzen 5 7600",
            source_key="amd-ryzen-5-7600",
            power_draw_w=65,
            specs={"socket": "AM5"},
        ),
        "psu": dict(
            id=3,
            name="Montech APX · 650 W",
            brand="Montech",
            model_number=None,
            source_key="docyx:b47683f9e9c8793111a3cfefdd951b1962ece49c4399c668a9cbd98c464b3772",
            specs=dict(wattage_w=650, form_factor="ATX", efficiency="plus", modular=False),
        ),
        "case": dict(
            id=4,
            name="NZXT H5 Flow (2024) · Black",
            brand="NZXT",
            model_number="H5 Flow (2024) Black",
            source_key="case-nzxt-h5-flow-2024-black",
            specs=dict(color="Black", _power_estimate={"status": "unconfirmed"}),
        ),
    }


def test_case_fits_but_cpu_peak_estimate_keeps_capacity_conditional(validate_parts):
    selected = build()
    selected["case"]["specs"].update(
        psu_sizes=["ATX"],
        max_psu_length_mm=200,
        max_psu_length_mm_source_url="https://example.test/case",
    )
    selected["psu"]["specs"]["length_mm"] = 150
    selected["gpu"]["specs"]["recommended_psu_w"] = 600
    original = deepcopy(selected)
    checks = validate_parts(selected)
    assert checks["PSU_CLEARANCE"]["result"] == "PASS" and checks["PSU_CASE"]["result"] == "PASS"
    assert checks["PSU_CAPACITY"]["result"] == "CONDITIONAL"
    assert selected == original


def test_below_gpu_manufacturer_recommendation_is_excluded(validate_parts):
    selected = build()
    selected["gpu"]["specs"]["recommended_psu_w"] = 600
    selected["psu"]["specs"]["wattage_w"] = 550
    checks = validate_parts(selected)
    assert checks["PSU_CAPACITY"]["result"] == "FAIL"
    assert checks["PSU_CASE"]["result"] == "UNKNOWN"


@pytest.mark.parametrize("wattage", [None, "unknown"])
def test_unusable_psu_wattage_remains_unresolved(wattage, validate_parts):
    selected = build()
    selected["psu"]["specs"]["wattage_w"] = wattage
    assert validate_parts(selected)["PSU_CAPACITY"]["result"] == "UNKNOWN"


@pytest.mark.parametrize(("length", "verdict"), [(201, "FAIL"), (130, "PASS"), (None, "UNKNOWN")])
def test_psu_dimensions_require_an_actual_measurement(length, verdict, validate_parts):
    selected = build()
    selected["case"]["specs"].update(
        max_psu_length_mm=200, max_psu_length_mm_source_url="https://example.test/case"
    )
    selected["psu"]["specs"]["length_mm"] = length
    assert validate_parts(selected)["PSU_CLEARANCE"]["result"] == verdict


def test_similar_gpu_or_case_cannot_override_the_database(validate_parts):
    selected = build()
    selected["gpu"]["specs"]["recommended_psu_w"] = 700
    for number in ("ZT-A30600H-10M", "ZT-A30600E2-10M", "test-sku"):
        selected["gpu"]["model_number"] = number
        checks = validate_parts(selected)
        assert checks["PSU_CASE"]["result"] == "UNKNOWN"
        assert checks["PSU_CAPACITY"]["result"] == "FAIL"
        assert not checks["PSU_CAPACITY"].get("sources")
