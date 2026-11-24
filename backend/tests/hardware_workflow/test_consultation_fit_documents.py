"""Exact-model document evidence for the consultation's mechanical and storage checks."""

import pytest


def assembly(series="H5", color="Black", board_key="mb-asus-tuf-gaming-b850-plus-wifi"):
    brand, model = (
        ("MSI", "MAG B650 TOMAHAWK WIFI")
        if board_key == "mb-b650-tomahawk"
        else ("ASUS", "TUF GAMING B850-PLUS WIFI")
    )
    return {
        "case": dict(
            category="case",
            brand="NZXT",
            model_number=f"{series} Flow (2024) {color}",
            source_key=f"case-nzxt-{series.lower()}-flow-2024-{color.lower()}",
            specs={"color": color},
        ),
        "motherboard": dict(
            category="motherboard",
            brand=brand,
            model_number=model,
            source_key=board_key,
            specs={"form_factor": "ATX"},
        ),
        "cooler": dict(
            category="cooler",
            brand="Thermalright",
            model_number="Peerless Assassin 120 SE",
            source_key="cooler-thermalright-peerless-assassin-120-se",
            specs={"color": "Black / Silver", "height_mm": 155},
        ),
        "storage": dict(specs={"type": "SSD", "interface": "SATA 6.0 Gb/s", "form_factor": 2.5}),
        "psu": dict(specs={"form_factor": "ATX"}),
    }


@pytest.mark.parametrize(("series", "limit"), [("H5", 170), ("H7", 185), ("가상 케이스", 160)])
def test_documented_dimensions_determine_fit_for_any_model(series, limit, validate_parts):
    selected = assembly(series=series)
    selected["case"]["specs"].update(
        max_cpu_cooler_mm=limit,
        board_sizes=["ATX"],
        max_cpu_cooler_mm_source_url="https://example.test/case",
    )
    selected["cooler"]["specs"]["height_mm_source_url"] = "https://example.test/cooler"
    checks = validate_parts(selected)
    assert checks["COOLER_CLEARANCE"]["result"] == "PASS"
    assert {s["url"] for s in checks["COOLER_CLEARANCE"]["sources"]} == {
        "https://example.test/case",
        "https://example.test/cooler",
    }
    assert checks["BOARD_CASE"]["result"] == "PASS"
    assert checks["PSU_CASE"]["result"] == "UNKNOWN"


@pytest.mark.parametrize("board", ["mb-b650-tomahawk", "mb-asus-tuf-gaming-b850-plus-wifi"])
def test_storage_uses_catalog_ports_on_this_board(board, validate_parts):
    selected = assembly(board_key=board)
    assert validate_parts(selected)["STORAGE_INTERFACE"]["result"] == "UNKNOWN"
    selected["motherboard"]["specs"].update(
        storage_ports={"sata_6g_ports": 4, "m2_sata": False},
        storage_ports_source_url="https://example.test/ports",
    )
    check = validate_parts(selected)["STORAGE_INTERFACE"]
    assert check["result"] == "PASS" and check["sources"][0]["url"].endswith("/ports")
    selected["storage"]["specs"]["interface"] = "M.2 SATA"
    assert validate_parts(selected)["STORAGE_INTERFACE"]["result"] == "FAIL"


def test_conflicting_catalog_values_do_not_gain_a_pass(validate_parts):
    selected = assembly()
    assert validate_parts(selected)["COOLER_CLEARANCE"]["result"] == "UNKNOWN"
    selected["case"]["specs"]["max_cpu_cooler_mm"] = 145
    assert validate_parts(selected)["COOLER_CLEARANCE"]["result"] == "FAIL"


def test_missing_parts_are_not_verified(validate_parts):
    for code in ("BOARD_CASE", "COOLER_CLEARANCE", "STORAGE_INTERFACE", "PSU_CASE"):
        assert validate_parts({})[code]["result"] == "UNKNOWN"
