import pytest

from app.domains.hardware.pc_consultation.memory_document import supplement_memory_check


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
def test_compares_only_module_shape_with_known_board_slot(selected, slot, result):
    selected["motherboard"]["specs"]["ram_form_factor"] = slot
    shape = {"check_type": "RAM_FORM_FACTOR", "result": "UNKNOWN"}
    qvl = {"check_type": "RAM_QVL", "result": "UNKNOWN"}
    supplement_memory_check(selected, [shape, qvl])
    assert shape["result"] == result
    if slot:
        assert shape["sources"][0]["url"].endswith("S1102-01-AVL.pdf")
    assert qvl == {"check_type": "RAM_QVL", "result": "UNKNOWN"}


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
def test_different_or_conflicting_product_keeps_unknown(selected, changes):
    selected["ram"].update(changes)
    shape = {"check_type": "RAM_FORM_FACTOR", "result": "UNKNOWN"}
    supplement_memory_check(selected, [shape])
    assert shape == {"check_type": "RAM_FORM_FACTOR", "result": "UNKNOWN"}


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


@pytest.mark.parametrize(
    ("model_number", "detail"),
    [(None, "실물 라벨의 .M16A1"), ("CT32G48C40U5.M16A1", "전체 품번이 일치")],
)
def test_asus_qvl_discloses_revision_and_tested_settings(qvl_selection, model_number, detail):
    qvl_selection["ram"]["model_number"] = model_number
    check = {"check_type": "RAM_QVL", "result": "UNKNOWN"}
    supplement_memory_check(qvl_selection, [check])
    assert check["result"] == "CONDITIONAL"
    assert detail in check["reason"] and "4800 MT/s" in check["reason"]
    assert check["sources"][0]["url"].startswith("https://www.asus.com/support/api/")
    assert "CT32G48C40U5.M16A1" in check["sources"][0]["text"]


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
def test_qvl_scope_does_not_transfer_to_other_parts(qvl_selection, role, change):
    qvl_selection[role].update(change)
    check = {"check_type": "RAM_QVL", "result": "UNKNOWN"}
    supplement_memory_check(qvl_selection, [check])
    assert check == {"check_type": "RAM_QVL", "result": "UNKNOWN"}


def test_qvl_cannot_override_an_explicit_other_verdict(qvl_selection):
    check = {"check_type": "RAM_QVL", "result": "FAIL", "reason": "existing conflict"}
    supplement_memory_check(qvl_selection, [check])
    assert check == {"check_type": "RAM_QVL", "result": "FAIL", "reason": "existing conflict"}
