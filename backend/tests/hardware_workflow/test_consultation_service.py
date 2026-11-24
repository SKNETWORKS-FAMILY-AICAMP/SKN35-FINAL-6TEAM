"""Exercise the client-facing consultation using isolated, explicitly marked test records."""

from unittest.mock import Mock

import pytest

from app.domains.hardware.pc_consultation import complete, cooling, service
from app.domains.hardware.pc_consultation.flow import InputError
from app.domains.hardware.pc_consultation.parts_db import CatalogSnapshot

BUILD = dict(cpu=101, motherboard=201, ram=302, gpu=402, storage=502, cooler=601, psu=701, case=801)
SURVEY = dict(
    mode="new",
    budget=1200000,
    purposes=["gaming"],
    resolution="qhd",
    frameRate="60",
    workScale="basic",
    owned={},
    problems=[],
)


@pytest.fixture
def shop(catalog_snapshot, monkeypatch):
    def read(**kwargs):
        ids = kwargs.get("part_ids", ())
        rows = [
            r
            for r in catalog_snapshot.parts
            if r["id"] in ids
            or r["category"] == kwargs.get("category")
            or kwargs.get("include_market")
        ]
        return CatalogSnapshot(rows, catalog_snapshot.compatibility)

    monkeypatch.setattr(service, "_read", read)
    monkeypatch.setattr(
        complete._SelectedBuild,
        "retrieve",
        lambda _, question, filters: [
            {
                "chunk_key": "test-chunk",
                "source_key": "test-source",
                "source_title": "Test source",
                "publisher": "Test",
                "source_url": "https://example.test/evidence",
                "verification_status": "verified",
            }
        ],
    )
    monkeypatch.setitem(SURVEY, "_assessments", {})
    monkeypatch.setitem(SURVEY, "_design", {})
    service.plan(SURVEY)
    return catalog_snapshot


def test_cooling_basket_revalidates_price_power_and_remaining_mounts(shop):
    rows = {r["id"]: r for r in shop.parts}
    fan = {
        **rows[601],
        "id": 610,
        "name": "가상 케이스 팬",
        "source_key": "test-fan",
        "price": 9000,
        "specs": {
            "cooling_type": "case_fan",
            "fans_per_item": 1,
            "fan_size_mm": 120,
            "thickness_mm": 25,
            "fan_w": 2,
        },
    }
    shop.parts.append(fan)
    rows[801]["specs"]["free_fan_bays"] = [
        {"position": "top", "count": 2, "diameter_mm": 120, "thickness_mm": 25}
    ]
    config = {"mode": "purchase", "fans": [{"part_id": 610, "quantity": 2}]}
    survey = {**SURVEY, "budget": 1218000, "_cooling": config}
    result = service.quote(survey, BUILD)
    assert result["total_amount"] == 1218000
    assert (result["items"][-1]["part_id"], result["items"][-1]["quantity"]) == (610, 2)
    checks = {c["code"]: c for c in result["validation"]["checks"]}
    assert checks["CASE_FANS"]["status"] == "PASS"
    rows[801]["specs"]["max_psu_length_mm"] = 160
    rows[702]["specs"]["length_mm"] = 140
    psus = service.candidates(
        dict(
            survey={**survey, "budget": 1500000},
            category="psu",
            budget=200000,
            selected={k: v for k, v in BUILD.items() if k not in ("psu", "case")},
        )
    )
    assert [option["part"]["part_id"] for option in psus["passed"]] == [702]
    rows[701]["specs"]["length_mm"] = 150
    regular = service.validate(SURVEY, BUILD)

    def get_power(v):
        return next(c["message"] for c in v["checks"] if c["code"] == "PSU_CAPACITY")

    assert get_power(result["validation"]) != get_power(regular)
    with pytest.raises(InputError):
        service.quote({**survey, "budget": 1217999}, BUILD)
    with pytest.raises(InputError):
        service.quote({**survey, "_cooling": {**config, "mode": "bundled"}}, BUILD)
    rows[101]["specs"]["included_cooler_source_key"] = rows[601]["source_key"]
    free = service.quote({**survey, "_cooling": {**config, "mode": "bundled"}}, BUILD)
    assert free["total_amount"] == result["total_amount"] - rows[601]["price"]
    assert next(i for i in free["items"] if i["part_id"] == 601)["unit_price"] == 0
    with pytest.raises(InputError):
        service.quote(survey, {**BUILD, "cooler": 610})

    rows[601]["power_draw_w"] = 1.68
    fan["specs"]["fan_w"] = 1.2
    adjusted = cooling.check_rows({"cooler": rows[601]}, {"_fans": [(fan, 2)]})
    assert str(adjusted["cooler"]["power_draw_w"]) == "4.08"
    rows[801]["specs"]["free_fan_bays"][0]["position"] = "front"
    assert (
        cooling.case_fit(
            {"case": rows[801], "cooler": {"specs": {"radiator_size_mm": 360}}}, [(fan, 2)]
        )["result"]
        == "FAIL"
    )
    rows[801]["specs"]["free_fan_bays"][0]["count"] = 1
    with pytest.raises(InputError):
        service.quote(survey, BUILD)
    choices = service.candidates(
        dict(
            survey=survey,
            category="case",
            budget=100000,
            selected={k: v for k, v in BUILD.items() if k != "case"},
        )
    )
    assert not choices["passed"]


def test_reuse_cooler_only_for_the_registered_owned_sku(shop):
    survey = {
        **SURVEY,
        "mode": "replacement",
        "problems": ["heat"],
        "owned": {
            k: {"name": "가상 보유 부품", "part_id": BUILD[k]} for k in ("cpu", "cooler", "case")
        },
    }
    service.plan(survey)
    result = service.candidates(
        {"survey": survey, "category": "cooler", "budget": 0, "selected": {}}
    )
    option = next(x for x in result["passed"] if x["cooling_mode"] == "reuse")
    assert option["part"]["current_price"] == 0
    config = {**survey, "_cooling": {"mode": "reuse", "fans": []}}
    assert service.quote(config, {"cooler": BUILD["cooler"]})["total_amount"] == 0
    with pytest.raises(InputError):
        service.quote(config, {"cooler": BUILD["gpu"]})


def test_new_plan_prices_budgets_and_complete_quote_uses_locked_build(shop):
    draft_plan = service.plan(SURVEY)
    assert set(draft_plan["steps"]) == set(BUILD)
    assert sum(draft_plan["allocations"].values()) == SURVEY["budget"]
    result = service.quote(SURVEY, BUILD)
    assert [i["part_id"] for i in result["items"]] == list(BUILD.values())
    assert result["total_amount"] == 1200000
    assert result["validation"]["basis"] == "api"
    assert result["validation"]["workflow_status"] == "needs_revision"
    assert result["validation"]["citations"][0]["chunk_key"] == "test-chunk"
    # Conditional QVL without a reviewed source cannot complete the official quote graph.
    assert any(c["code"] == "QUOTE_WORKFLOW" for c in result["validation"]["checks"])
    for record in shop.compatibility:
        record["source_url"] = "https://example.test/official"
    improved = service.quote(SURVEY, BUILD)
    assert improved["validation"]["workflow_status"] == "completed"
    assert improved["validation"]["status"] in {"CONDITIONAL", "UNKNOWN"}


def test_catalog_psu_threshold_is_rechecked_when_case_is_added(shop):
    rows = {r["id"]: r for r in shop.parts}
    selected = {k: v for k, v in BUILD.items() if k not in {"psu", "case"}}
    gpu = rows[selected["gpu"]]["specs"]
    gpu.pop("recommended_psu_w", None)
    gpu.update(_power_estimate={"status": "unconfirmed"}, required_pcie_8pin=2)
    rows[701]["specs"].pop("pcie_8pin_available", None)
    total = sum(rows[v]["power_draw_w"] for v in selected.values())
    cpu = rows[selected["cpu"]]
    total += cpu["specs"]["cpu_power_limit_w"] - cpu["power_draw_w"]
    rows[701]["specs"]["wattage_w"] = total
    rows[702]["specs"]["wattage_w"] = total - 1
    result = service.candidates(
        dict(survey=SURVEY, category="psu", budget=300000, selected=selected)
    )
    assert [c["part"]["part_id"] for c in result["passed"]] == [701]
    checks = {c["code"]: c["status"] for c in result["passed"][0]["validation"]["checks"]}
    assert checks["PSU_CAPACITY"] == "PASS"
    assert "GPU_POWER_CONNECTORS" not in checks
    selected["psu"] = 701
    case_request = dict(survey=SURVEY, category="case", budget=300000, selected=selected)
    assert service.candidates(case_request)["passed"] == []
    rows[701]["specs"]["wattage_w"] += rows[801]["power_draw_w"]
    assert 801 in {c["part"]["part_id"] for c in service.candidates(case_request)["passed"]}
    rows[701]["specs"]["pcie_8pin_available"] = 1
    assert 801 in {c["part"]["part_id"] for c in service.candidates(case_request)["passed"]}
    rows[701]["specs"]["pcie_8pin_available"] = 2
    rows[selected["storage"]]["power_draw_w"] = None
    assert service.candidates(case_request)["passed"] == []


def test_storage_prefers_compatible_m2_before_sales_and_price(shop):
    rows = {r["id"]: r for r in shop.parts}
    board = rows[201]["specs"]
    board.pop("supported_drives")
    board.update(
        storage_ports={"sata_6g_ports": 4}, m2_storage_slots=[{"name": "M2", "pcie": ["2280"]}]
    )
    rows[501]["specs"].update(interface="SATA 6.0 Gb/s", form_factor=2.5)
    rows[501]["sold_units"] = 25
    rows[502]["specs"].update(interface="M.2 PCIe 4.0 X4", form_factor="M.2-2280")
    req = dict(survey=SURVEY, category="storage", selected={"motherboard": 201}, budget=300000)
    options = service.candidates(req)["passed"]
    assert [c["part"]["part_id"] for c in options] == [502, 501]
    assert options[0]["recommended"]
    assert service.candidates(req, lowest_price=True)["passed"][0]["part"]["part_id"] == 501
    board["supported_drives"] = ["SATA 6.0 Gb/s", "M.2 PCIe 4.0 X4"]
    rows[502]["specs"]["form_factor"] = "M.2-2230"
    assert [c["part"]["part_id"] for c in service.candidates(req)["passed"]] == [501]


def test_replacement_only_charges_chosen_parts_and_keeps_unknown_owned_models(shop):
    survey = {
        **SURVEY,
        "mode": "replacement",
        "problems": ["gaming", "multitasking"],
        "owned": {
            k: {"name": "Test", "part_id": v} for k, v in {**BUILD, "ram": 301, "gpu": 401}.items()
        },
    }
    service.plan(survey)
    result = service.quote(survey, {"gpu": 402, "ram": 302})
    assert result["total_amount"] == 440000
    assert [i["category"] for i in result["items"]] == ["ram", "gpu"]
    with pytest.raises(InputError):
        service.quote(survey, {"gpu": 401, "ram": 302})
    with pytest.raises(InputError):
        service.quote({**survey, "budget": 100}, {"gpu": 402, "ram": 302})
    with pytest.raises(InputError):
        service.candidates(
            {"survey": survey, "selected": {"ram": 401}, "category": "gpu", "budget": 100}
        )
    unnamed = {**survey, "owned": {"cpu": {"name": "Unmapped CPU", "part_id": None}}}
    checked = service.validate(unnamed, {"gpu": 402})
    assert any(c["status"] == "UNKNOWN" and c["code"] == "CPU_SUPPORT" for c in checked["checks"])


def test_absent_ids_incomplete_quotes_and_out_of_scope_roles_are_rejected(shop):
    with pytest.raises(InputError):
        service.validate(SURVEY, {"cpu": 123456})
    with pytest.raises(InputError):
        service.quote(SURVEY, {"cpu": 101})
    with pytest.raises(InputError):
        service.quote({**SURVEY, "mode": "replacement", "problems": ["heat"]}, {"cpu": 101})
    with pytest.raises(InputError):
        service.plan({**SURVEY, "budget": -1})


def test_candidates_are_server_validated_and_rebalancing_does_not_change_selection(shop):
    request = {
        "survey": SURVEY,
        "category": "gpu",
        "budget": 410000,
        "selected": {"cpu": 101, "ram": 302, "motherboard": 201},
    }
    result = service.candidates(request)
    rows = result["passed"] + result["needsReview"]
    assert rows and all(r["part"]["current_price"] <= request["budget"] for r in rows)
    assert all(r["validation"]["basis"] == "api" for r in rows)
    before = dict(request["selected"])
    proposal = service.rebalance(request, 350000)
    assert proposal["allocations"]["gpu"] == 350000 and request["selected"] == before


def test_future_checks_remain_pending_and_explicit_database_conflicts_fail(shop):
    first = service.candidates(
        {"survey": SURVEY, "category": "cpu", "selected": {}, "budget": 250000}
    )
    assert first["passed"]
    checks = first["passed"][0]["validation"]["checks"]
    assert any(c["code"] == "CPU_SUPPORT" and c["status"] == "PENDING" for c in checks)
    selected = service.validate(SURVEY, {"cpu": 101})
    assert selected["status"] == "PASS"
    assert any(c["code"] == "CPU_SUPPORT" and c["status"] == "PENDING" for c in selected["checks"])
    shop.compatibility.append(
        {
            "compatibility_id": 999,
            "check_type": "KNOWN_CONFLICT",
            "part_a_id": 101,
            "part_b_id": 801,
            "support_status": "UNSUPPORTED",
        }
    )
    validation = service.validate(SURVEY, {"cpu": 101, "case": 801})
    assert validation["status"] == "FAIL"
    assert any(
        c["code"] == "KNOWN_CONFLICT" and c["status"] == "FAIL" for c in validation["checks"]
    )


def test_local_answer_never_calls_external_provider_by_default(monkeypatch):
    monkeypatch.delenv("BUILDWISE_CONSULTATION_PROVIDER", raising=False)
    monkeypatch.setattr(service.advisor, "dotenv_values", lambda *a, **k: {})
    passage = {
        "chunk_key": "doc-1",
        "title": "검토 문서",
        "text": "확인한 사양",
        "origin": "제조사",
        "url": "https://example.test/evidence",
    }
    monkeypatch.setattr(service.advisor, "_retrieve", lambda *a: ("keyword", [passage]))
    provider = Mock(side_effect=AssertionError("unexpected external provider"))
    monkeypatch.setattr(service.advisor, "_request_openai", provider)
    reply = service.chat("어떤 규격인가요?", None, {}, [])
    assert reply["sources"] == [passage] and passage["text"] in reply["text"]
    provider.assert_not_called()


def test_new_build_ranks_only_target_meeting_candidates_by_paid_units(shop):
    indexed = {r["id"]: r for r in shop.parts}
    for number, units in [(401, 900), (402, 2), (403, 7), (404, 7)]:
        indexed[number]["sold_units"] = units
    request = dict(
        survey=SURVEY, category="gpu", budget=500_000, selected={"cpu": 101, "motherboard": 201}
    )
    result = service.candidates(request)
    assert [r["part"]["part_id"] for r in result["passed"]] == [404, 403, 402, 405]
    assert result["passed"][0]["recommended"]
    assert result["passed"][0]["validation"]["status"] == "PASS"
    assert any(c["status"] == "PENDING" for c in result["passed"][0]["validation"]["checks"])
    indexed[404]["specs"].pop("recommended_psu_w")
    selection = service.candidates(request)["passed"]
    no_psu_yet = next(r for r in selection if r["part"]["part_id"] == 404)
    assert any(
        c["code"] == "PSU_CAPACITY" and c["status"] == "PENDING"
        for c in no_psu_yet["validation"]["checks"]
    )
    request["survey"] = {**SURVEY, "frameRate": "144"}
    assert service.candidates(request)["passed"] == []
    indexed[201]["specs"]["pcie_x16_slots"] = 0
    assert service.candidates({**request, "survey": SURVEY})["passed"] == []


@pytest.mark.parametrize("first_page_passes", [False, True])
def test_slow_shortlist_preserves_ranking_and_reuses_decisions(
    shop, monkeypatch, first_page_passes
):
    sample = next(r for r in shop.parts if r["category"] == "cpu")
    shop.parts[:] = [
        {**sample, "id": 1000 + i, "name": f"fixture CPU {i}", "sold_units": 30 - i}
        for i in range(20)
    ]
    elapsed = 0
    batches = []
    generate = service.designer.generate

    def slow_model(schema, instruction, data):
        nonlocal elapsed
        output = generate(schema, instruction, data)
        batches.append([row["name"] for _, row in data["candidates"]])
        if len(batches) == 1 and not first_page_passes:
            for decision in output.decisions:
                decision.suitable = False
        elapsed += 20
        return output

    monkeypatch.setattr(service, "monotonic", lambda: elapsed)
    monkeypatch.setattr(service.designer, "generate", slow_model)
    request = dict(survey=SURVEY, category="cpu", budget=500_000, selected={})
    if first_page_passes:
        result = service.candidates(request)
        assert [r["part"]["part_id"] for r in result["passed"]] == list(range(1000, 1010))
    else:
        result = service.candidates(request)
        assert [r["part"]["part_id"] for r in result["passed"]] == list(range(1010, 1020))
        assert set(batches[0]).isdisjoint(batches[1])
    assert len(batches) == (1 if first_page_passes else 2)


def test_upgrade_requires_measured_improvement_and_compatible_fit(shop):
    owned = {k: {"part_id": v} for k, v in {**BUILD, "gpu": 402}.items()}
    survey = {**SURVEY, "mode": "replacement", "owned": owned, "problems": ["gaming"]}
    service.plan(survey)
    request = dict(survey=survey, category="gpu", budget=500_000, selected={})
    result = service.candidates(request)
    # 405 performs the same as the owned GPU. Cheaper 404 does not fit the case.
    assert [r["part"]["part_id"] for r in result["passed"]] == [403]
    assert result["needsReview"] == []
    with pytest.raises(InputError, match="기존 부품"):
        service.quote(survey, {"gpu": 405})
    owned["gpu"] = {"part_id": None, "name": "사용자 입력 모델"}
    assert service.candidates(request)["passed"] == []


def test_identified_qvl_requires_source_and_case_includes_radiator(shop):
    request = dict(
        survey=SURVEY, category="ram", budget=180_000, selected={"cpu": 101, "motherboard": 201}
    )
    assert service.candidates(request)["passed"] == []
    for record in shop.compatibility:
        record["source_url"] = "https://example.test/fixture-qvl"
    assert service.candidates(request)["passed"][0]["validation"]["status"] == "CONDITIONAL"
    indexed = {r["id"]: r for r in shop.parts}
    indexed[601]["specs"]["radiator_size_mm"] = 360
    indexed[801]["specs"]["gpu_clearance_by_front_radiator_mm"] = {"360": 240}
    indexed[802]["specs"]["gpu_clearance_by_front_radiator_mm"] = {"360": 290}
    selected = {k: v for k, v in BUILD.items() if k != "case"}
    result = service.candidates(
        dict(
            survey={**SURVEY, "budget": 1_500_000},
            category="case",
            budget=100_000,
            selected=selected,
        )
    )
    assert [r["part"]["part_id"] for r in result["passed"]] == [802]
