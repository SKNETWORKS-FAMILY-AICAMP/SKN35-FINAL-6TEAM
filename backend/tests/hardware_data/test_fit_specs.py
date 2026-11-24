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
    assert checks["GPU_POWER_CONNECTORS"]["result"] == "UNKNOWN"
    assert checks["PSU_CLEARANCE"]["result"] == "UNKNOWN"
    drive["specs"] = {"interface": "SAS 6.0 Gb/s"}
    assert checks_for(board, drive)["STORAGE_INTERFACE"]["result"] == "FAIL"


def test_conflicting_review_stops_before_update():
    row = reviewed_part("Intel Core i5-14400F", 1)
    review = load_fit_reviews()[row["specs"]["_provenance"]["source_key"]]
    with pytest.raises(ValueError, match="socket"):
        fit_updates(row["specs"] | {"socket": "AM4"}, "cpu", row["model_number"], review)
