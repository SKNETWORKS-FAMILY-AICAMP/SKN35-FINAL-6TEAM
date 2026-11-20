"""Exercise the client-facing consultation using isolated, explicitly marked test records."""

from unittest.mock import Mock

import pytest

from app.domains.hardware.pc_consultation import complete, service
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
    return catalog_snapshot


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


def test_replacement_only_charges_chosen_parts_and_keeps_unknown_owned_models(shop):
    survey = {
        **SURVEY,
        "mode": "replacement",
        "problems": ["gaming", "multitasking"],
        "owned": {
            k: {"name": "Test", "part_id": v} for k, v in {**BUILD, "ram": 301, "gpu": 401}.items()
        },
    }
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
