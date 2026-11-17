from dataclasses import replace
from decimal import Decimal

from app.domains.hardware.assembly import AssemblyPart, validate_assembly

CPU = AssemblyPart(
    1, "CPU specimen", "cpu", {"cpu_power_limit_w": 117, "cpu_family": "test series"}
)
BOARD = AssemblyPart(
    2,
    "Board specimen",
    "motherboard",
    {"ram_type": "DDR5", "ram_form_factor": "DIMM", "memory_slots": 4, "ram_max_gb": 128},
)
MEMORY = AssemblyPart(
    3,
    "Memory specimen",
    "ram",
    {"ram_type": "DDR5", "ram_form_factor": "DIMM", "modules_per_item": 2, "capacity_gb": 64},
)
GPU = AssemblyPart(
    4, "GPU specimen", "gpu", {"length_mm": 348, "gpu_power_w": 170, "recommended_psu_w": 550}
)
CASE = AssemblyPart(
    5,
    "Case specimen",
    "case",
    {"max_gpu_length_mm": 355, "gpu_clearance_by_front_radiator_mm": {"360": 300}},
)
PSU = AssemblyPart(6, "PSU specimen", "psu", {"wattage_w": 550})


def checks(parts, evidence=(), **options):
    return {c.check_type: c for c in validate_assembly(parts, list(evidence), **options)}


def test_ram_kit_quantities_include_all_modules_and_capacity():
    in_limit = checks([BOARD, replace(MEMORY, quantity=2)])
    assert in_limit["RAM_SLOTS"].result == "PASS"
    assert "합계 4개" in in_limit["RAM_SLOTS"].reason
    assert in_limit["RAM_CAPACITY"].result == "PASS"
    over_limit = checks([BOARD, replace(MEMORY, quantity=3)])
    assert over_limit["RAM_SLOTS"].result == "FAIL"
    assert over_limit["RAM_CAPACITY"].result == "FAIL"


def test_ram_generation_and_physical_format_are_checked_independently():
    laptop_ram = replace(
        MEMORY, specs={**MEMORY.specs, "ram_type": "DDR4", "ram_form_factor": "SO-DIMM"}
    )
    found = checks([BOARD, laptop_ram])
    assert found["RAM_TYPE"].result == "FAIL"
    assert found["RAM_FORM_FACTOR"].result == "FAIL"
    assert found["RAM_SLOTS"].result == "PASS"
    assert checks([BOARD, replace(MEMORY, specs={})])["RAM_TYPE"].result == "UNKNOWN"


def test_qvl_matches_cpu_family_and_single_kit_only():
    row = dict(
        compatibility_id=7,
        part_a_id=2,
        part_b_id=3,
        check_type="MEMORY_QVL",
        support_status="CONDITIONAL",
        conditions={"cpu_family": "test series", "kits": 1},
    )
    assert checks([BOARD, CPU, MEMORY], [row])["RAM_QVL"].compatibility_ids == (7,)
    assert checks([BOARD, CPU, replace(MEMORY, quantity=2)], [row])["RAM_QVL"].result == "UNKNOWN"
    assert checks([BOARD, replace(CPU, specs={}), MEMORY], [row])["RAM_QVL"].result == "UNKNOWN"


def test_qvl_can_match_verified_cpu_series_for_a_subfamily():
    cpu = replace(CPU, specs={"cpu_family": "Ryzen 8000G", "cpu_series": "Ryzen 8000"})
    row = dict(
        compatibility_id=9,
        part_a_id=2,
        part_b_id=3,
        check_type="MEMORY_QVL",
        support_status="CONDITIONAL",
        conditions={"cpu_family": "Ryzen 8000", "kits": 1},
    )
    assert checks([BOARD, cpu, MEMORY], [row])["RAM_QVL"].compatibility_ids == (9,)
    row["conditions"]["cpu_family"] = "Ryzen 9000"
    assert checks([BOARD, cpu, MEMORY], [row])["RAM_QVL"].result == "UNKNOWN"


def test_bios_release_confirmed_to_support_cpu_is_not_a_minimum():
    row = dict(
        compatibility_id=10,
        part_a_id=2,
        part_b_id=1,
        check_type="CPU_SUPPORT",
        support_status="CONDITIONAL",
        bios_scope="NOT_SPECIFIED",
        min_bios_version=None,
        conditions={"known_supported_bios": "7D75v1M3"},
    )
    result = checks([BOARD, CPU], [row], bios_version="7D75v1M3")["CPU_SUPPORT"]
    assert result.result == "CONDITIONAL"
    assert "7D75v1M3" in result.reason
    assert "최소 지원 버전은 미확인" in result.reason


def test_cpu_integrated_board_passes_without_a_separate_cpu():
    board = replace(BOARD, specs={**BOARD.specs, "socket": "Integrated CPU specimen"})
    result = checks([board, MEMORY])
    assert result["CPU_SUPPORT"].result == "PASS"
    assert result["RAM_TYPE"].result == "PASS"
    assert checks([BOARD, MEMORY])["CPU_SUPPORT"].result == "UNKNOWN"
    assert checks([board, CPU])["CPU_SUPPORT"].result == "FAIL"
    assert checks([board, replace(CPU, quantity=2)])["CPU_SUPPORT"].result == "FAIL"


def test_cpu_integrated_board_uses_available_power_limits():
    board = replace(BOARD, specs={**BOARD.specs, "socket": "Integrated CPU specimen"})
    assert checks([board, GPU, PSU])["PSU_CAPACITY"].result == "CONDITIONAL"
    low_psu = replace(PSU, specs={"wattage_w": 500})
    assert checks([board, GPU, low_psu])["PSU_CAPACITY"].result == "FAIL"
    specified = replace(board, specs={**board.specs, "cpu_power_limit_w": 20})
    assert checks([specified, GPU, PSU])["PSU_CAPACITY"].result == "PASS"


def test_gpu_clearance_accounts_for_documented_radiator_configuration():
    assert checks([CASE, GPU])["GPU_CLEARANCE"].result == "PASS"
    assert checks([CASE, GPU], front_radiator_mm=360)["GPU_CLEARANCE"].result == "FAIL"
    assert checks([CASE, GPU], front_radiator_mm=280)["GPU_CLEARANCE"].result == "UNKNOWN"
    too_long = replace(GPU, specs={**GPU.specs, "length_mm": 356})
    assert checks([CASE, too_long], front_radiator_mm=280)["GPU_CLEARANCE"].result == "FAIL"


def test_psu_checks_both_system_estimate_and_card_vendor_recommendation():
    found = checks([CPU, GPU, PSU])["PSU_CAPACITY"]
    assert found.result == "PASS"
    assert "시스템 추정 453W" in found.reason
    low_psu = replace(PSU, specs={"wattage_w": 500})
    assert checks([CPU, GPU, low_psu])["PSU_CAPACITY"].result == "FAIL"
    assert checks([CPU, GPU, PSU], other_load_w=170)["PSU_CAPACITY"].result == "FAIL"
    assert checks([CPU, replace(GPU, quantity=2), PSU])["PSU_CAPACITY"].result == "UNKNOWN"


def test_cpu_tdp_does_not_substitute_for_max_power():
    tdp_only = replace(CPU, specs={"tdp_w": 65})
    assert checks([tdp_only, GPU, PSU])["PSU_CAPACITY"].result == "CONDITIONAL"
    no_power_data = replace(GPU, specs={"length_mm": 348})
    assert checks([tdp_only, no_power_data, PSU])["PSU_CAPACITY"].result == "UNKNOWN"


def test_psu_sums_catalog_loads_and_quantities_and_reports_gpu_estimate():
    gpu = replace(
        GPU,
        specs={"recommended_psu_w": 550, "_power_estimate": {"status": "unconfirmed"}},
        power_draw_w=Decimal("200.00"),
    )
    psu = replace(PSU, specs={"wattage_w": 600}, power_draw_w=900)
    parts = [
        replace(CPU, power_draw_w=65),
        replace(BOARD, power_draw_w=80),
        replace(MEMORY, quantity=2, power_draw_w=20),
        replace(CASE, power_draw_w=10),
        AssemblyPart(7, "SSD", "storage", {}, quantity=2, power_draw_w=15),
        AssemblyPart(8, "Cooler", "cooler", {}, quantity=2, power_draw_w=Decimal("12.50")),
        gpu,
    ]
    insufficient = checks([*parts, psu])["PSU_CAPACITY"]
    assert insufficient.result == "FAIL"
    assert "시스템 추정 628W" in insufficient.reason
    assert "기타 185" in insufficient.reason
    sufficient = checks([*parts, replace(psu, specs={"wattage_w": 650})])["PSU_CAPACITY"]
    assert sufficient.result == "CONDITIONAL"
    assert "최대 부하 추정 포함" in sufficient.reason


def test_psu_counts_board_with_integrated_cpu_as_one_load():
    board = replace(
        BOARD,
        specs={"socket": "Integrated Atom"},
        power_draw_w=80,
    )
    result = checks([board, replace(MEMORY, power_draw_w=20), PSU], other_load_w=0)["PSU_CAPACITY"]
    assert "시스템 추정 125W" in result.reason
