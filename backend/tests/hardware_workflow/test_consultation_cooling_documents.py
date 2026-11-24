import pytest


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


def test_nominal_cpu_tdp_and_test_rig_capacity_do_not_prove_thermal_performance(
    selected_parts, validate_parts
):
    selected_parts["cpu"]["specs"] = {"socket": "AM5", "tdp_w": 65}
    selected_parts["cooler"]["specs"].update(sockets=["AM5"], test_rig_w=260)
    checks = validate_parts(selected_parts)
    assert checks["COOLER_SOCKET"]["result"] == "PASS"
    assert checks["COOLER_POWER"]["result"] == "UNKNOWN"


@pytest.mark.parametrize(
    ("category", "changes"),
    [
        ("cpu", {"model_number": "Ryzen 5 7600X"}),
        ("cooler", {"source_key": "other-variant"}),
        ("cooler", {"model_number": "Peerless Assassin 120 SE V2"}),
        ("cooler", {"specs": {"color": "White"}}),
    ],
)
def test_sibling_parts_cannot_borrow_thermal_evidence(
    selected_parts, category, changes, validate_parts
):
    selected_parts[category].update(changes)
    check = validate_parts(selected_parts)["COOLER_POWER"]
    assert check["result"] == "UNKNOWN"
    assert not check.get("sources")


def test_existing_verdict_is_preserved(selected_parts, validate_parts):
    selected_parts["cpu"]["specs"] = {"cpu_power_limit_w": 150}
    selected_parts["cooler"]["specs"]["cooling_limit_w"] = 100
    assert validate_parts(selected_parts)["COOLER_POWER"]["result"] == "FAIL"
    selected_parts["cooler"]["specs"]["cooling_limit_w"] = 151
    assert validate_parts(selected_parts)["COOLER_POWER"]["result"] == "PASS"


def test_manufacturer_cpu_pair_requires_the_exact_chip_socket_and_cooler(validate_parts):
    cpu = {"name": "Intel Core i5-14400F", "specs": {"socket": "LGA1700"}}
    cooler = {"name": "Noctua NH-D12L"}
    checks = validate_parts({"cpu": cpu, "cooler": cooler})
    assert checks["COOLER_POWER"]["result"] == checks["COOLER_SOCKET"]["result"] == "PASS"
    assert checks["COOLER_POWER"]["sources"][0]["url"].endswith("intel-core-i5-14400f")
    for changed in ({"name": "Intel Core i5-14400"}, {"specs": {"socket": "AM5"}}):
        assert (
            validate_parts({"cpu": cpu | changed, "cooler": cooler})["COOLER_POWER"]["result"]
            == "UNKNOWN"
        )
    cooler["name"] += " variant"
    assert validate_parts({"cpu": cpu, "cooler": cooler})["COOLER_POWER"]["result"] == "UNKNOWN"
