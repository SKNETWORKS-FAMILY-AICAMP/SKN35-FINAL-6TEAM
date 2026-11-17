from dataclasses import replace

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
