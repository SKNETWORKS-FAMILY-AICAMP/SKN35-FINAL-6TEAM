"""Exact-model document evidence for the consultation's mechanical and storage checks."""

import pytest

from app.domains.hardware.consultation_demo.fit_documents import supplement_checks


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


def check(selected, code, before="UNKNOWN"):
    original = dict(check_type=code, result=before, reason="기존 DB 판정", compatibility_ids=[])
    return supplement_checks(selected, [original])[0]


@pytest.mark.parametrize(("series", "color", "limit"), [("H5", "White", 170), ("H7", "Black", 185)])
def test_exact_case_and_cooler_have_a_sourced_height_limit(series, color, limit):
    selected = assembly(series=series, color=color)
    size = check(selected, "COOLER_CLEARANCE")
    assert size["result"] == "PASS"
    assert f"{limit} mm" in size["reason"] and "155 mm" in size["reason"]
    assert len(size["sources"]) == 2
    doc = size["sources"][0]
    assert doc.keys() == {"title", "url", "chunk_key", "text", "origin"}
    assert doc["url"].startswith("https://support.nzxt.com/") and f"{limit} mm" in doc["text"]
    assert check(selected, "BOARD_CASE")["result"] == "PASS"
    psu = check(selected, "PSU_CASE")
    assert psu["result"] == "UNKNOWN" and "200 mm" in psu["reason"]


@pytest.mark.parametrize("board", ["mb-b650-tomahawk", "mb-asus-tuf-gaming-b850-plus-wifi"])
@pytest.mark.parametrize(
    ("interface", "form"), [("SATA 6.0 Gb/s", 2.5), ("M.2 PCIe 3.0 X4", "M.2-2280")]
)
def test_storage_uses_form_and_signaling_on_this_board(board, interface, form):
    selected = assembly(board_key=board)
    selected["storage"]["specs"].update(interface=interface, form_factor=form)
    fit = check(selected, "STORAGE_INTERFACE")
    assert fit["result"] == "PASS" and len(fit["sources"]) == 1
    assert selected["motherboard"]["model_number"] in fit["sources"][0]["title"]
    selected["storage"]["specs"].update(form_factor="M.2-2242")
    assert check(selected, "STORAGE_INTERFACE")["result"] == "UNKNOWN"


def test_old_variants_similar_names_and_conflicting_catalog_values_do_not_gain_a_pass():
    selected = assembly()
    assert check(selected, "COOLER_CLEARANCE", before="FAIL")["result"] == "FAIL"
    selected["case"]["specs"]["max_cpu_cooler_mm"] = 145
    assert check(selected, "COOLER_CLEARANCE")["result"] == "UNKNOWN"
    selected["case"]["specs"]["color"] = "White"
    assert check(selected, "BOARD_CASE")["result"] == "UNKNOWN"
    selected["motherboard"]["model_number"] = "TUF GAMING B550-PLUS"
    assert check(selected, "STORAGE_INTERFACE")["result"] == "UNKNOWN"


def test_unmatched_form_and_signaling_and_missing_parts_are_not_verified():
    selected = assembly()
    selected["storage"]["specs"].update(interface="SATA 6.0 Gb/s", form_factor="M.2-2280")
    assert check(selected, "STORAGE_INTERFACE")["result"] == "UNKNOWN"
    for code in ("BOARD_CASE", "COOLER_CLEARANCE", "STORAGE_INTERFACE", "PSU_CASE"):
        assert check({}, code)["result"] == "UNKNOWN"
