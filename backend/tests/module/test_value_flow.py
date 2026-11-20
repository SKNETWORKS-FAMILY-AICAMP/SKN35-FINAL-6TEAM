"""Synthetic fixtures: real nodes are connected; only external service I/O is mocked."""

from copy import deepcopy
from decimal import Decimal
from unittest.mock import Mock

import pytest

from app.domains.hardware.quote_graph import build_graph, nodes
from app.domains.hardware.quote_graph.adapters import ServiceUnavailable


def request():
    return {
        "question": "게임용 조립 자료", "purpose": "게임", "budget_krw": 500000,
        "locked_parts": {8: 2}, "rag_filters": {"topic": "memory_qvl"},
        "bios_version": "F3", "front_radiator_mm": 30, "other_load_w": 75,
    }


def hit(**changes):
    return {
        "chunk_key": "TEST:001", "source_key": "TEST", "source_url": "https://example.test/guide",
        "source_title": "Synthetic test guide", "publisher": "Fixture",
        "verification_status": "verified", **changes,
    }


def test_consultation_to_retrieval_preserves_question_filters_and_citations():
    raw = request()
    original = deepcopy(raw)
    state = nodes.consultation({"request": raw})
    evidence = hit()
    services = Mock()
    services.retrieve.return_value = [evidence]
    update = nodes.retrieve_rag(state, services)
    services.retrieve.assert_called_once_with(
        original["question"], {"topic": "memory_qvl", "verification_status": "verified"}
    )
    assert state["requirements"]["budget_krw"] == Decimal("500000")
    assert state["requirements"]["locked_parts"] == {8: 2}
    assert update["rag_hits"] == [evidence]
    for key in ("chunk_key", "source_key", "source_url", "source_title", "publisher"):
        assert update["citations"][0][key] == evidence[key]
    assert raw == original


@pytest.mark.parametrize("changes", [{"verification_status": "unverified"}, {"source_url": ""}])
def test_untrusted_retrieval_result_cannot_enter_quotation(changes):
    services = Mock()
    services.retrieve.return_value = [hit(**changes)]
    state = build_graph(services).invoke({"request": request()})
    assert state["status"] == "needs_revision"
    assert state["quote_draft"] is None
    assert state["citations"] == []
    services.catalog.assert_not_called()
    services.validate.assert_not_called()


def test_selected_quantities_and_options_reach_validator_and_quote_unchanged():
    state = nodes.consultation({"request": request()})
    checks = [{"check_type": kind, "result": "PASS"} for kind in sorted(nodes.ASSEMBLY_CHECK_TYPES)]
    state.update(selection={8: 2}, selection_basis={8: "Synthetic fixture selection"})
    services = Mock()
    services.validate.return_value = checks
    update = nodes.validation(state, services)
    services.validate.assert_called_once_with(
        {8: 2}, bios_version="F3", front_radiator_mm=30, other_load_w=75
    )
    assert update["checks"] == checks
    assert update["conditions"] == []
    assert update["blocking_failures"] == []
    state.update(update)
    state.update(candidates=[{
        "part_id": 8, "category": "storage", "name": "TEST SSD",
        "current_price": Decimal("10000.50"), "price_checked_at": "2026-11-20T00:00:00Z",
        "specs": {"_provenance": {"price_status": "test", "price_basis": "fixture"}},
    }], citations=[hit()])
    result = nodes.quotation(state)
    item = result["quote_draft"]["items"][0]
    assert result["status"] == "completed"
    assert item["part_id"] == 8
    assert item["quantity"] == 2
    assert item["unit_price"] == Decimal("10000.50")
    assert item["line_total"] == Decimal("20001.00")
    assert item["price_status"] == "test"
    assert item["selection_basis"] == "Synthetic fixture selection"
    assert result["quote_draft"]["total_amount"] == Decimal("20001.00")
    assert result["quote_draft"]["checks"] == checks
    assert result["quote_draft"]["citations"] == state["citations"]


def test_incomplete_validation_blocks_graph_quotation():
    state = nodes.consultation({"request": request()})
    state["selection"] = {8: 2}
    services = Mock()
    services.validate.return_value = [{"check_type": "RAM_TYPE", "result": "PASS"}]
    update = nodes.validation(state, services)
    assert update["status"] == "needs_revision"
    assert update["reason"] == "조립 검증 결과가 불완전합니다."
    assert state["quote_draft"] is None


def test_retrieval_service_error_stops_downstream_calls():
    services = Mock()
    services.retrieve.side_effect = ServiceUnavailable("synthetic outage")
    state = build_graph(services).invoke({"request": request()})
    assert state["status"] == "needs_revision"
    assert "synthetic outage" in state["reason"]
    assert state["quote_draft"] is None
    services.catalog.assert_not_called()
    services.validate.assert_not_called()
