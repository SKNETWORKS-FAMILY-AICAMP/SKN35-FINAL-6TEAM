import pytest

from app.domains.hardware.ingestion.fit_specs import fit_updates, load_fit_reviews
from app.domains.hardware.pc_consultation.catalog import validate_selection


def reviewed_part(name, part_id, initial=None):
    review = next(r for r in load_fit_reviews().values() if r["raw_name"] == name)
    specs = dict(
        initial or {},
        _provenance={
            "source": "docyx",
            "source_key": review["source_key"],
            "raw_name": name,
        },
    )
    model = review.get("match_model")
    specs.update(fit_updates(specs, review["category"], model, review))
    assert fit_updates(specs, review["category"], model, review) == {}
    return dict(
        id=part_id,
        name=name,
        category=review["category"],
        specs=specs,
        model_number=model,
        power_draw_w=None,
    )


def checks_for(*parts):
    ids = {p["category"]: p["id"] for p in parts}
    return {c["check_type"]: c for c in validate_selection(ids, parts)}


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("Iceberg Thermal IceFLOE T95", "FAIL"),
        ("ARCTIC Alpine 17", "PASS"),
    ],
)
def test_reviewed_socket_and_installation_height(name, expected):
    checks = checks_for(
        reviewed_part("Intel Core i5-14400F", 1),
        reviewed_part(name, 2),
        reviewed_part("Cooler Master MasterBox Q300L", 3),
    )
    assert checks["COOLER_SOCKET"]["result"] == expected
    assert len(checks["COOLER_SOCKET"]["sources"]) == 2
    assert checks["COOLER_CLEARANCE"]["result"] == "PASS"
    assert checks["COOLER_POWER"]["result"] == "UNKNOWN"


def test_native_ports_and_unidentified_power_supply():
    board = reviewed_part("ASRock H610M-HDV/M.2+ D5", 1)
    drive = reviewed_part("Samsung Spinpoint M8", 2, {"interface": "SATA 3.0 Gb/s"})
    gpu = reviewed_part("ASRock Intel Arc A380 Challenger ITX", 3)
    psu = reviewed_part("Thermaltake Smart", 4)
    case = reviewed_part("Cooler Master MasterBox Q300L", 5)
    checks = checks_for(board, drive, gpu, psu, case)
    assert checks["STORAGE_INTERFACE"]["result"] == "PASS"
    assert "GPU_POWER_CONNECTORS" not in checks
    assert checks["PSU_CLEARANCE"]["result"] == "UNKNOWN"
    drive["specs"] = {"interface": "SAS 6.0 Gb/s"}
    assert checks_for(board, drive)["STORAGE_INTERFACE"]["result"] == "FAIL"


def test_reviewed_aio_and_case_use_installed_stack_and_tested_cpu():
    cooler = reviewed_part("ID-COOLING FX360 PRO", 1, {"radiator_size_mm": 360})
    case = reviewed_part("NZXT H5 Flow (2024)", 2)
    gpu = {"id": 3, "name": "가상 GPU", "category": "gpu", "specs": {"length_mm": 350}}
    cpu = {
        "id": 4,
        "name": "Intel Core i7-13700K",
        "category": "cpu",
        "specs": {"socket": "LGA1700"},
    }
    checks = checks_for(cooler, case, gpu, cpu)
    assert checks["COOLER_POWER"]["result"] == checks["COOLER_CLEARANCE"]["result"] == "PASS"
    assert checks["COOLER_POWER"]["sources"]
    gpu["specs"]["length_mm"] = 380
    assert checks_for(cooler, case, gpu, cpu)["GPU_CLEARANCE"]["result"] == "FAIL"


def test_conflicting_review_stops_before_update():
    row = reviewed_part("Intel Core i5-14400F", 1)
    review = load_fit_reviews()[row["specs"]["_provenance"]["source_key"]]
    with pytest.raises(ValueError, match="socket"):
        fit_updates(row["specs"] | {"socket": "AM4"}, "cpu", row["model_number"], review)


@pytest.mark.parametrize(
    ("interface", "size", "expected"),
    [
        ("M.2 PCIe 5.0 X4", "M.2-2280", "PASS"),
        ("M.2 PCIe 4.0 X4", "M.2-2230", "UNKNOWN"),
        ("M.2 PCIe 4.0 X4", None, "UNKNOWN"),
        ("M.2 SATA", "M.2-2280", "FAIL"),
    ],
)
def test_m2_drive_requires_matching_socket_mode_and_size(interface, size, expected):
    board = reviewed_part("Asus TUF GAMING B850-PLUS WIFI", 1)
    drive = {
        "id": 2,
        "category": "storage",
        "name": "가상 SSD",
        "specs": {"interface": interface, "form_factor": size},
    }
    assert checks_for(board, drive)["STORAGE_INTERFACE"]["result"] == expected


def test_documented_slot_presence_and_unknown_storage_mode():
    board = reviewed_part("Asus ROG STRIX B850-E GAMING WIFI", 1)
    gpu = reviewed_part("ASRock Intel Arc A380 Challenger ITX", 2)
    check = checks_for(board, gpu)["GPU_BOARD"]
    assert check["result"] == "PASS" and check["sources"]
    board["specs"]["pcie_x16_slots"] = 0
    assert checks_for(board, gpu)["GPU_BOARD"]["result"] == "FAIL"
    drive = reviewed_part("Samsung Spinpoint M8", 3)
    drive["specs"] = {"interface": "M.2 SATA"}
    assert checks_for(board, drive)["STORAGE_INTERFACE"]["result"] == "UNKNOWN"
