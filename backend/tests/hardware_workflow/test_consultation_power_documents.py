"""Exact SKU matching and independent case/stock power checks."""

from copy import deepcopy

import pytest

from app.domains.hardware.assembly import validate_assembly
from app.domains.hardware.pc_consultation.power_documents import (
    assembly_power_parts,
    supplement_power_checks,
)


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


def checks(selected, before="UNKNOWN"):
    capacity = next(
        c
        for c in validate_assembly(assembly_power_parts(selected), [])
        if c.check_type == "PSU_CAPACITY"
    )
    load = dict(check_type=capacity.check_type, result=capacity.result, reason=capacity.reason)
    fit = dict(check_type="PSU_CASE", result=before, reason="DB 사양")
    supplement_power_checks(selected, [load, fit])
    return load, fit


def test_case_fits_but_cpu_peak_estimate_keeps_capacity_conditional():
    selected = build()
    original = deepcopy(selected)
    load, fit = checks(selected)
    assert fit["result"] == "PASS"
    assert "140 mm" in fit["reason"] and "200 mm" in fit["reason"]
    assert "150 mm" in fit["reason"] and "50 mm" in fit["reason"]
    assert load["result"] == "CONDITIONAL"
    assert "제조사 권장 600W" in load["reason"] and "PPT" in load["reason"]
    assert "8핀" in load["reason"] and "추정" in load["reason"]
    assert {s["chunk_key"] for s in load["sources"]} >= {
        "POWER:ZOTAC-3060-TWIN-EDGE-E",
        "POWER:ZOTAC-3060-TWIN-EDGE-E2",
        "POWER:AMD-RYZEN-MASTER-PPT",
        "AMD:RYZEN-5-7600",
    }
    assert {s["chunk_key"] for s in fit["sources"]} == {
        "POWER:NZXT-H5-FLOW-2024-PSU",
        "POWER:MONTECH-APX-650W",
        "POWER:MONTECH-APX-650W-SECOND-SPEC",
    }
    assert selected == original


def test_below_gpu_manufacturer_recommendation_is_excluded():
    selected = build()
    selected["psu"]["specs"]["wattage_w"] = 550
    load, fit = checks(selected)
    assert load["result"] == "FAIL" and "600W" in load["reason"]
    assert fit["result"] == "UNKNOWN"
    assert "8핀" not in load["reason"]


@pytest.mark.parametrize("wattage", [None, "unknown"])
def test_unusable_psu_wattage_and_conflicting_gpu_data_remain_unresolved(wattage):
    selected = build()
    selected["psu"]["specs"]["wattage_w"] = wattage
    selected["gpu"]["specs"]["recommended_psu_w"] = 450
    load, fit = checks(selected)
    assert load["result"] == "UNKNOWN" and "달라" in load["reason"]
    assert fit["result"] == "UNKNOWN"


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("length_mm", 201),
        ("length_mm", 130),
    ],
)
def test_conflicting_psu_dimensions_never_get_promoted(field, value):
    selected = build()
    selected["psu"]["specs"][field] = value
    assert checks(selected)[1]["result"] == "UNKNOWN"
    assert checks(selected, before="FAIL")[1]["result"] == "FAIL"


def test_similar_gpu_or_case_not_attributed_and_more_restrictive_db_limits_are_preserved():
    selected = build()
    selected["case"]["model_number"] = "H5 Flow (2022) Black"
    selected["gpu"]["model_number"] = "ZT-A30600H-10M"
    selected["gpu"]["specs"]["recommended_psu_w"] = 700
    load, fit = checks(selected)
    assert fit["result"] == "UNKNOWN" and load["result"] == "FAIL"
    assert not any("ZOTAC" in s["chunk_key"] for s in load["sources"])
    selected["gpu"]["model_number"] = "ZT-A30600E2-10M"
    load, _ = checks(selected)
    assert load["result"] == "FAIL" and "700W" in load["reason"] and "달라" in load["reason"]
    assert "POWER:ZOTAC-3060-TWIN-EDGE-E2" in [s["chunk_key"] for s in load["sources"]]
    assert "POWER:ZOTAC-3060-TWIN-EDGE-E" not in [s["chunk_key"] for s in load["sources"]]
