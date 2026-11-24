import pytest


@pytest.fixture
def selected():
    return {
        "motherboard": {"specs": {"ram_form_factor": "DIMM"}},
        "ram": {
            "brand": "Crucial",
            "name": "Crucial CT32G48C40U5 32 GB",
            "model_number": None,
            "specs": {
                "capacity_gb": 32,
                "modules_per_item": 1,
                "speed_mtps": 4800,
                "ram_type": "DDR5",
            },
        },
    }


@pytest.mark.parametrize(
    ("slot", "result"), [("DIMM", "PASS"), ("SO-DIMM", "FAIL"), (None, "UNKNOWN")]
)
def test_compares_only_module_shape_with_known_board_slot(selected, slot, result, validate_parts):
    selected["motherboard"]["specs"]["ram_form_factor"] = slot
    selected["ram"]["specs"]["ram_form_factor"] = "DIMM"
    checks = validate_parts(selected)
    assert checks["RAM_FORM_FACTOR"]["result"] == result
    assert checks["RAM_QVL"]["result"] == "UNKNOWN"


@pytest.mark.parametrize(
    "changes",
    [
        {"model_number": "CT32G48C40S5"},
        {"name": "Crucial CT32G48C40U5T 32 GB"},
        {"name": "Crucial CB16GU4800"},
        {"brand": "Another"},
        {"specs": {"capacity_gb": 16}},
    ],
)
def test_different_or_conflicting_product_keeps_unknown(selected, changes, validate_parts):
    selected["ram"].update(changes)
    assert validate_parts(selected)["RAM_FORM_FACTOR"]["result"] == "UNKNOWN"


@pytest.fixture
def qvl_selection(selected):
    selected["motherboard"].update(
        source_key="mb-asus-tuf-gaming-b850-plus-wifi",
        brand="ASUS",
        model_number="TUF GAMING B850-PLUS WIFI",
    )
    selected["cpu"] = {
        "source_key": "amd-ryzen-5-7600",
        "brand": "AMD",
        "model_number": "Ryzen 5 7600",
        "specs": {"cpu_family": "Ryzen 7000"},
    }
    return selected


def test_qvl_evidence_requires_the_catalog_pair_and_processor_family(qvl_selection, validate_parts):
    evidence = {
        "compatibility_id": 3,
        "check_type": "MEMORY_QVL",
        "part_a_id": 1,
        "part_b_id": 2,
        "conditions": {"kits": 1, "cpu_family": "Ryzen 7000"},
        "support_status": "CONDITIONAL",
        "source_url": "https://example.test/tested-kit",
    }
    check = validate_parts(qvl_selection, [evidence])["RAM_QVL"]
    assert check["result"] == "CONDITIONAL"
    assert check["sources"][0]["url"] == evidence["source_url"]
    for changed in ({"part_b_id": 99}, {"conditions": {"kits": 1, "cpu_family": "other"}}):
        assert validate_parts(qvl_selection, [evidence | changed])["RAM_QVL"]["result"] == "UNKNOWN"


@pytest.mark.parametrize(
    ("role", "change"),
    [
        ("ram", {"model_number": "CT32G48C40U5.M16B1"}),
        ("ram", {"name": "Crucial CT32G48C40U5.M16B1 32 GB"}),
        (
            "ram",
            {
                "specs": {
                    "ram_type": "DDR5",
                    "capacity_gb": 32,
                    "modules_per_item": 2,
                    "speed_mtps": 4800,
                }
            },
        ),
        ("motherboard", {"model_number": "TUF GAMING B850M-PLUS WIFI"}),
        ("cpu", {"model_number": "Ryzen 5 8600G"}),
    ],
)
def test_qvl_scope_does_not_transfer_to_other_parts(qvl_selection, role, change, validate_parts):
    qvl_selection[role].update(change)
    assert validate_parts(qvl_selection)["RAM_QVL"]["result"] == "UNKNOWN"


def test_qvl_cannot_override_an_explicit_other_verdict(qvl_selection, validate_parts):
    conflict = {
        "compatibility_id": 4,
        "check_type": "KNOWN_CONFLICT",
        "support_status": "UNSUPPORTED",
        "part_a_id": 1,
        "part_b_id": 2,
    }
    assert validate_parts(qvl_selection, [conflict])["KNOWN_CONFLICT"]["result"] == "FAIL"
