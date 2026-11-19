"""Run the compiled quote graph with synthetic catalog rows and real RAG passages.

Prices, power figures, part IDs and compatibility rows below are test fixtures.
The synthetic GPU explicitly requires a 550 W PSU. The cited Kingston document
is a general SSD guide, with no asserted mapping to these fixture part IDs.
"""

import json
import sys
from contextlib import closing, contextmanager
from datetime import datetime
from decimal import Decimal
from io import StringIO
from unittest.mock import patch

import pytest
from qdrant_client import QdrantClient

from app.domains.hardware import check_assembly
from app.domains.hardware.quote_graph import build_graph
from app.domains.hardware.quote_graph.adapters import ServiceUnavailable
from app.domains.hardware.quote_graph.nodes import consultation
from app.rag.embeddings import DIMENSION
from app.rag.loader import load_corpus
from app.rag.points import build_points
from app.rag.qdrant_store import QdrantStore

GUIDE_KEY = "BW20261119:CHK-HW19-015"
GUIDE_URL = "https://media.kingston.com/pdfs/MKF_283.2_Flash_Memory_Guide_EN.pdf"
QVL_URL = "https://catalog.example.test/memory/qvl"
INITIAL_SELECTION = {1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 8: 2, 9: 1}
FINAL_SELECTION = {1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 7: 1, 8: 2, 9: 1}


def sample_request():
    return {
        "question": "조립용 부품 견적과 M.2 SATA SSD의 키와 길이를 확인할 자료를 주세요.",
        "purpose": "테스트용 데스크톱 조립",
        "budget_krw": 480000,
        "categories": ["cpu", "motherboard", "ram", "gpu", "case", "psu", "storage", "cooler"],
        "locked_parts": {8: 2},
        "rag_filters": {"topic": "M.2 인터페이스·키·길이"},
        "allow_conditional_qvl": True,
    }


def _part(key, category, price, watts=None, **specs):
    return {
        "part_id": key,
        "name": f"TEST {category} {key}",
        "category": category,
        "brand": "Fixture",
        "model_number": f"TEST-{key}",
        "specs": {**specs, "_provenance": {"price_status": "test", "price_basis": "fixture"}},
        "current_price": Decimal(price),
        "price_checked_at": datetime(2026, 11, 19),
        "currency": "KRW",
        "power_draw_w": watts,
        "image_url": None,
    }


class FixtureServices:
    def __init__(self, store, query_vector):
        self.store = store
        self.query_vector = query_vector
        self.validations = []
        self.rows = [
            _part(
                1, "cpu", "100000.10", 65, cpu_power_limit_w=95, cpu_family="fixture", socket="T"
            ),
            _part(
                2,
                "motherboard",
                "70000",
                20,
                socket="T",
                ram_type="DDR5",
                ram_form_factor="DIMM",
                memory_slots=4,
                ram_max_gb=128,
            ),
            _part(
                3,
                "ram",
                "30000",
                6,
                ram_type="DDR5",
                ram_form_factor="DIMM",
                capacity_gb=32,
                modules_per_item=2,
            ),
            _part(4, "gpu", "180000", 150, recommended_psu_w=550, length_mm=280),
            _part(5, "case", "20000", 5, max_gpu_length_mm=300),
            _part(6, "psu", "25000", wattage_w=500),
            _part(7, "psu", "35000", wattage_w=550),
            _part(8, "storage", "10000.50", 5, type="SSD", form_factor="M.2"),
            _part(9, "cooler", "15000", 3),
        ]
        self.evidence = [
            {
                "compatibility_id": 101,
                "check_type": "CPU_SUPPORT",
                "part_a_id": 2,
                "part_b_id": 1,
                "support_status": "SUPPORTED",
                "bios_scope": "ALL",
                "conditions": {},
                "source_url": "https://catalog.example.test/cpu/support",
            },
            {
                "compatibility_id": 102,
                "check_type": "MEMORY_QVL",
                "part_a_id": 2,
                "part_b_id": 3,
                "support_status": "CONDITIONAL",
                "bios_scope": "NOT_SPECIFIED",
                "conditions": {"cpu_family": "fixture", "kits": 1},
                "source_url": QVL_URL,
            },
        ]

    def catalog(self, categories, *, locked_ids=()):
        return [r for r in self.rows if r["category"] in categories or r["part_id"] in locked_ids]

    def validate(self, selection, **options):
        # Replace just the two DB reads. The real entry point selects evidence,
        # calls validate_assembly, and resolves source URLs from compatibility IDs.
        selected_rows = [dict(r) for r in self.rows if r["part_id"] in selection]
        with (
            patch.object(check_assembly, "list_parts", return_value=selected_rows),
            patch.object(check_assembly, "list_compatibility", return_value=self.evidence),
        ):
            checks = check_assembly.check_catalog_assembly(None, selection=selection, **options)[
                "checks"
            ]
        self.validations.append((dict(selection), checks))
        return checks

    def retrieve(self, question, filters):
        hits = self.store.search(question, self.query_vector, mode="hybrid", filters=filters)
        return [{**hit.payload, "score": hit.score} for hit in hits]


@contextmanager
def offline_services():
    points = build_points(load_corpus())
    vectors = []
    for index in range(len(points)):
        vector = [0.0] * DIMENSION
        vector[index] = 1.0
        vectors.append(vector)
    guide = next(i for i, p in enumerate(points) if p.payload["chunk_key"] == GUIDE_KEY)
    with closing(QdrantClient(":memory:")) as client:
        store = QdrantStore(client)
        assert store.upsert(points, vectors) == 85
        yield FixtureServices(store, vectors[guide])


@pytest.fixture
def services():
    with offline_services() as service:
        yield service


def _run(services, request):
    return build_graph(services).invoke({"request": request})


def _check(checks, kind):
    return next(check for check in checks if check["check_type"] == kind)


def test_500w_to_550w_quote_preserves_quantity_evidence_and_prices(services):
    with patch(
        "app.db.paid_quotes.save_paid_quote", side_effect=AssertionError("payment write")
    ) as save:
        state = _run(services, sample_request())
    save.assert_not_called()
    assert state["status"] == "completed"
    assert state["retry_count"] == 1
    assert state["attempted_selections"] == [INITIAL_SELECTION, FINAL_SELECTION]
    assert state["selection"] == FINAL_SELECTION
    assert [selection for selection, _ in services.validations] == [
        INITIAL_SELECTION,
        FINAL_SELECTION,
    ]
    old_psu, new_psu = [_check(checks, "PSU_CAPACITY") for _, checks in services.validations]
    assert (old_psu["result"], new_psu["result"]) == ("FAIL", "PASS")
    assert "500W" in old_psu["reason"] and "550W" in new_psu["reason"]
    assert not state["blocking_failures"]

    quote = state["quote_draft"]
    assert quote["currency"] == "KRW"
    assert quote["total_amount"] == Decimal("470001.10")
    items = {row["part_id"]: row for row in quote["items"]}
    assert {key: item["quantity"] for key, item in items.items()} == FINAL_SELECTION
    assert items[8]["unit_price"] == Decimal("10000.50")
    assert items[8]["line_total"] == Decimal("20001.00")
    assert items[8]["price_status"] == "test" and items[8]["price_basis"] == "fixture"
    assert all(row["chunk_keys"] == [] for row in items.values())
    assert sum(row["line_total"] for row in items.values()) == quote["total_amount"]
    assert "PSU_CAPACITY" in items[7]["selection_basis"]
    qvl = _check(quote["checks"], "RAM_QVL")
    assert qvl["result"] == "CONDITIONAL"
    assert tuple(qvl["compatibility_ids"]) == (102,)
    assert qvl["source_urls"] == [QVL_URL]
    assert quote["conditions"] == [qvl]
    assert quote["checks"] == state["checks"]
    assert quote["citations"] == state["citations"]
    hit = next(r for r in state["rag_hits"] if r["chunk_key"] == GUIDE_KEY)
    assert hit["source_url"] == GUIDE_URL
    assert hit["links"] == {"parts": [], "compatibilities": []}
    assert GUIDE_URL in [r["source_url"] for r in quote["citations"]]
    assert all(not item["chunk_keys"] for item in quote["items"])


def test_repeated_graph_invocation_is_deterministic(services):
    graph = build_graph(services)
    results = [graph.invoke({"request": sample_request()}) for _ in range(2)]
    assert results[0]["status"] == "completed"
    assert results[0] == results[1]


def test_cli_json_request_returns_conditional_draft(services, monkeypatch, capsys):
    from app.domains.hardware.quote_graph.__main__ import main

    # JSON converts locked part ID keys to strings, as happens on the command line.
    monkeypatch.setattr(sys, "stdin", StringIO(json.dumps(sample_request(), ensure_ascii=False)))
    assert main(["-"], services=services) == 0
    result = json.loads(capsys.readouterr().out)
    assert result["status"] == "completed"
    assert result["retry_count"] == 1 and result["selection"]["8"] == 2
    assert result["quote_draft"]["total_amount"] == "470001.10"
    assert result["conditions"][0]["result"] == "CONDITIONAL"
    assert result["citations"][0]["source_url"] == GUIDE_URL


def test_consultation_extracts_korean_budget_purpose_and_component_conditions():
    state = consultation(
        {"request": {"question": "예산 48만 원 게임용 MSI 메인보드 선호 DDR5 필수"}}
    )
    req = state["requirements"]
    assert state["status"] == "running"
    assert req["budget_krw"] == Decimal(480000) and req["purpose"] == "게임"
    assert req["preferred_brands"] == {"motherboard": "MSI"}
    assert req["required_specs"] == {"ram": {"ram_type": "DDR5"}}
    assert state["rag_filters"] == {"verification_status": "verified"}


def test_consultation_routes_explicit_source_brand_and_released_category_to_rag_filters():
    request = {
        "question": "게임용 견적에 MSI 공식 문서와 메인보드·저장장치 자료를 포함해 주세요.",
        "budget_krw": 480000,
    }
    state = consultation({"request": request})
    assert state["status"] == "running"
    assert state["rag_filters"] == {
        "brand": "MSI",
        "category": "메인보드·저장장치",
        "verification_status": "verified",
    }
    assert state["requirements"]["required_brands"] == {}


@pytest.mark.parametrize(
    "request_changes",
    [
        {"budget_krw": None},
        {"allow_conditional_qvl": "true"},
        {"question": "예산 49만 원 게임용 본체를 조립해 주세요."},
    ],
)
def test_invalid_request_stops_before_any_service(request_changes):
    result = _run(None, {**sample_request(), **request_changes})
    assert result["status"] == "needs_input"
    assert result["reason"] and result.get("quote_draft") is None


def test_qvl_consent_defaults_to_needs_input(services):
    request = sample_request()
    del request["allow_conditional_qvl"]
    state = _run(services, request)
    assert state["status"] == "needs_input"
    assert _check(state["checks"], "RAM_QVL")["result"] == "CONDITIONAL"
    assert state["reason"]
    assert state.get("quote_draft") is None


def test_conditional_qvl_consent_does_not_clear_missing_bios(services):
    services.evidence[0].update(bios_scope="MIN_VERSION", min_bios_version="F3")
    state = _run(services, sample_request())
    assert _check(state["checks"], "CPU_SUPPORT")["result"] == "CONDITIONAL"
    assert state["status"] == "needs_input"
    assert state.get("quote_draft") is None


def test_qvl_consent_requires_matching_manufacturer_evidence(services):
    services.evidence[1]["conditions"]["cpu_family"] = "other fixture"
    state = _run(services, sample_request())
    qvl = _check(state["checks"], "RAM_QVL")
    assert qvl["result"] == "UNKNOWN" and not qvl["compatibility_ids"]
    assert state["status"] == "needs_revision"
    assert state.get("quote_draft") is None


def test_matched_qvl_without_a_source_url_cannot_unlock_quotation(services):
    services.evidence[1]["source_url"] = None
    state = _run(services, sample_request())
    qvl = _check(state["checks"], "RAM_QVL")
    assert qvl["result"] == "CONDITIONAL" and not qvl["source_urls"]
    assert state["status"] == "needs_revision"
    assert state.get("quote_draft") is None


@pytest.mark.parametrize("blocker", ["limit", "locked", "budget", "no_candidate"])
def test_unsatisfied_psu_returns_needs_revision(services, blocker):
    request = sample_request()
    if blocker == "limit":
        request["max_retries"] = 0
    elif blocker == "locked":
        request["locked_parts"][6] = 1
    elif blocker == "budget":
        request["budget_krw"] = 465000
    else:
        services.rows = [r for r in services.rows if r["part_id"] != 7]
    state = _run(services, request)
    assert state["status"] == "needs_revision"
    assert state["retry_count"] == 0
    assert state["reason"]
    assert state.get("quote_draft") is None
    assert _check(state["checks"], "PSU_CAPACITY")["result"] == "FAIL"


def test_missing_evidence_and_retrieval_outage_have_distinct_reasons(services):
    request = sample_request()
    request["rag_filters"] = {"brand": "MSI", "topic": "M.2 인터페이스·키·길이"}
    empty = _run(services, request)
    with patch.object(services, "retrieve", side_effect=ServiceUnavailable("offline test")):
        unavailable = _run(services, sample_request())
    assert empty["reason"] != unavailable["reason"]
    for result in (empty, unavailable):
        assert result["status"] == "needs_revision"
        assert not result["citations"]
        assert result.get("quote_draft") is None
    assert services.validations == []
