import pytest

from app.domains.hardware.pc_consultation.cooling_documents import supplement_cooling_check


@pytest.fixture
def selected_parts():
    return {
        "cpu": {"source_key": "amd-ryzen-5-7600", "brand": "AMD", "model_number": "Ryzen 5 7600"},
        "cooler": {
            "source_key": "cooler-thermalright-peerless-assassin-120-se",
            "brand": "Thermalright",
            "model_number": "Peerless Assassin 120 SE",
            "specs": {"color": "Black / Silver"},
        },
    }


def test_nominal_cpu_tdp_and_test_rig_capacity_do_not_prove_thermal_performance(selected_parts):
    cooling = {"check_type": "COOLER_POWER", "result": "UNKNOWN"}
    socket = {"check_type": "COOLER_SOCKET", "result": "PASS"}
    supplement_cooling_check(selected_parts, [socket, cooling])
    assert socket == {"check_type": "COOLER_SOCKET", "result": "PASS"}
    assert cooling["result"] == "UNKNOWN"
    assert [source["chunk_key"] for source in cooling["sources"]] == [
        "AMD:RYZEN-5-7600",
        "THERMALRIGHT:PA120-SE:DTPC",
    ]
    assert "65 W" in cooling["sources"][0]["text"]
    assert "125~260 W" in cooling["sources"][1]["text"]
    assert "온도 측정" in cooling["reason"]


@pytest.mark.parametrize(
    ("category", "changes"),
    [
        ("cpu", {"model_number": "Ryzen 5 7600X"}),
        ("cooler", {"source_key": "other-variant"}),
        ("cooler", {"model_number": "Peerless Assassin 120 SE V2"}),
        ("cooler", {"specs": {"color": "White"}}),
    ],
)
def test_sibling_parts_cannot_borrow_thermal_evidence(selected_parts, category, changes):
    selected_parts[category].update(changes)
    check = {"check_type": "COOLER_POWER", "result": "UNKNOWN"}
    supplement_cooling_check(selected_parts, [check])
    assert check == {"check_type": "COOLER_POWER", "result": "UNKNOWN"}


def test_existing_verdict_is_preserved(selected_parts):
    check = {"check_type": "COOLER_POWER", "result": "FAIL", "reason": "정격 초과"}
    supplement_cooling_check(selected_parts, [check])
    assert check == {"check_type": "COOLER_POWER", "result": "FAIL", "reason": "정격 초과"}
