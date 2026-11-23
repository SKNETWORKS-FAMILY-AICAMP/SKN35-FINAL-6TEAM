"""Synthetic fixtures: real nodes are connected; only external service I/O is mocked."""

from copy import deepcopy
from decimal import Decimal
from unittest.mock import Mock

import pytest
from app.domains.hardware.quote_graph import build_graph, nodes
from app.domains.hardware.quote_graph.adapters import ServiceUnavailable


def request():
    return {
        "question": "게임용 조립 자료",
        "purpose": "게임",
        "budget_krw": 500000,
        "locked_parts": {8: 2},
        "rag_filters": {"topic": "memory_qvl"},
        "bios_version": "F3",
        "front_radiator_mm": 30,
        "other_load_w": 75,
    }


def hit(**changes):
    return {
        "chunk_key": "TEST:001",
        "source_key": "TEST",
        "source_url": "https://example.test/guide",
        "source_title": "Synthetic test guide",
        "publisher": "Fixture",
        "verification_status": "verified",
        **changes,
    }


def test_consultation_to_retrieval_preserves_question_filters_and_citations(flow):
    raw = request()
    original = deepcopy(raw)
    state = nodes.consultation({"request": raw})
    evidence = hit()
    services = Mock()
    services.retrieve.return_value = [evidence]
    update = nodes.retrieve_rag(state, services)
    flow.begin(
        "상담 정규화",
        "RAG 검색 서비스",
        inputs=original,
        mode="실제 상담/RAG 노드 + 외부 검색 Mock",
        exclusions="실제 Qdrant 접속·모델 추론·사용자 계정 인증은 검사하지 않음",
    )
    flow.equal("호출 횟수", 1, services.retrieve.call_count)
    flow.equal(
        "질문·검색 필터",
        (original["question"], {"topic": "memory_qvl", "verification_status": "verified"}),
        services.retrieve.call_args.args,
    )
    services.retrieve.assert_called_once_with(
        original["question"], {"topic": "memory_qvl", "verification_status": "verified"}
    )
    assert state["requirements"]["budget_krw"] == Decimal("500000")
    assert state["requirements"]["locked_parts"] == {8: 2}
    assert update["rag_hits"] == [evidence]
    flow.equal("원본 입력 보존", original, raw)
    flow.equal("정규화된 예산", Decimal("500000"), state["requirements"]["budget_krw"])
    flow.equal("고정 상품 PK·수량", {8: 2}, state["requirements"]["locked_parts"])
    flow.equal("검색 반환 근거", [evidence], update["rag_hits"])
    flow.begin(
        "RAG 검색 응답",
        "출처 인용 상태",
        inputs={"hits": [evidence]},
        mode="실제 출처 추출 노드 + 가상 검색 응답",
        exclusions="문서 URL의 실제 접속·진위 검증은 별도",
    )
    for key in ("chunk_key", "source_key", "source_url", "source_title", "publisher"):
        flow.equal(key, evidence[key], update["citations"][0][key])
        assert update["citations"][0][key] == evidence[key]
    assert raw == original


@pytest.mark.parametrize("changes", [{"verification_status": "unverified"}, {"source_url": ""}])
def test_untrusted_retrieval_result_cannot_enter_quotation(changes, flow):
    services = Mock()
    services.retrieve.return_value = [hit(**changes)]
    state = build_graph(services).invoke({"request": request()})
    flow.begin(
        "미검증·출처 없는 검색 응답",
        "그래프 후속 설계/견적 차단",
        inputs={"request": request(), "search_result": hit(**changes)},
        mode="실제 LangGraph + 외부 서비스 Mock",
        exclusions="실제 DB/Qdrant·인증·영구 견적 저장 제외",
    )
    for key, expected in {"status": "needs_revision", "quote_draft": None, "citations": []}.items():
        flow.equal(key, expected, state[key])
    flow.equal("카탈로그 후속 호출", 0, services.catalog.call_count)
    flow.equal("검증기 후속 호출", 0, services.validate.call_count)
    assert state["status"] == "needs_revision"
    assert state["quote_draft"] is None
    assert state["citations"] == []
    services.catalog.assert_not_called()
    services.validate.assert_not_called()


def test_design_to_validator_preserves_quantities_and_settings(flow):
    state = nodes.consultation({"request": request()})
    checks = [{"check_type": kind, "result": "PASS"} for kind in sorted(nodes.ASSEMBLY_CHECK_TYPES)]
    state.update(selection={8: 2}, selection_basis={8: "Synthetic fixture selection"})
    services = Mock()
    services.validate.return_value = checks
    update = nodes.validation(state, services)
    flow.begin(
        "설계 선택 상태",
        "조립 검증 서비스",
        inputs={
            "selection": {8: 2},
            "bios_version": "F3",
            "front_radiator_mm": 30,
            "other_load_w": 75,
        },
        mode="실제 검증 노드 + 검증 서비스 Mock",
        exclusions="가상 PK 8 사용. 실제 상품 존재·DB 규격 검증은 별도",
    )
    flow.equal("호출 횟수", 1, services.validate.call_count)
    flow.equal("선택 PK·수량 인수", ({8: 2},), services.validate.call_args.args)
    flow.equal(
        "BIOS·라디에이터·부하 설정",
        {"bios_version": "F3", "front_radiator_mm": 30, "other_load_w": 75},
        services.validate.call_args.kwargs,
    )
    services.validate.assert_called_once_with(
        {8: 2}, bios_version="F3", front_radiator_mm=30, other_load_w=75
    )
    assert update["checks"] == checks
    assert update["conditions"] == []
    assert update["blocking_failures"] == []
    flow.equal("반환된 개별 검사 결과", checks, update["checks"])
    flow.equal("조건부 항목", [], update["conditions"])
    flow.equal("차단 항목", [], update["blocking_failures"])


def test_validation_to_quotation_preserves_pk_prices_and_evidence(flow):
    state = nodes.consultation({"request": request()})
    checks = [{"check_type": kind, "result": "PASS"} for kind in sorted(nodes.ASSEMBLY_CHECK_TYPES)]
    state.update(selection={8: 2}, selection_basis={8: "Synthetic fixture selection"})
    services = Mock()
    services.validate.return_value = checks
    update = nodes.validation(state, services)
    state.update(update)
    state.update(
        candidates=[
            {
                "part_id": 8,
                "category": "storage",
                "name": "TEST SSD",
                "current_price": Decimal("10000.50"),
                "price_checked_at": "2026-11-20T00:00:00Z",
                "specs": {"_provenance": {"price_status": "test", "price_basis": "fixture"}},
            }
        ],
        citations=[hit()],
    )
    result = nodes.quotation(state)
    item = result["quote_draft"]["items"][0]
    flow.begin(
        "검증 통과 상태·상품 후보",
        "견적 계산 노드",
        inputs={
            "selection": {8: 2},
            "unit_price": Decimal("10000.50"),
            "checks": checks,
            "citation": hit(),
        },
        mode="실제 검증/견적 노드 + 가상 상품·검증 응답",
        exclusions="실제 가격·결제·DB 견적 INSERT는 수행하지 않음",
    )
    flow.equal("종료 상태", "completed", result["status"])
    for key, expected in {
        "part_id": 8,
        "quantity": 2,
        "unit_price": Decimal("10000.50"),
        "line_total": Decimal("20001.00"),
        "price_status": "test",
        "selection_basis": "Synthetic fixture selection",
    }.items():
        flow.equal(key, expected, item[key])
    flow.equal("total_amount", Decimal("20001.00"), result["quote_draft"]["total_amount"])
    flow.equal("checks", checks, result["quote_draft"]["checks"])
    flow.equal("citations", state["citations"], result["quote_draft"]["citations"])
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


def test_incomplete_validation_blocks_graph_quotation(flow):
    state = nodes.consultation({"request": request()})
    state["selection"] = {8: 2}
    services = Mock()
    services.validate.return_value = [{"check_type": "RAM_TYPE", "result": "PASS"}]
    update = nodes.validation(state, services)
    flow.begin(
        "불완전 검증 응답",
        "견적 진입 상태",
        inputs={"selection": {8: 2}, "checks": services.validate.return_value},
        mode="실제 검증 노드 + 검사 1개만 반환하는 Mock",
        exclusions="이 사례는 노드의 차단 상태 검사. 전체 그래프 후속 호출은 graph 묶음에서 검사",
    )
    flow.equal("상태", "needs_revision", update["status"])
    flow.equal("사유", "조립 검증 결과가 불완전합니다.", update["reason"])
    flow.equal("견적 없음", None, state["quote_draft"])
    assert update["status"] == "needs_revision"
    assert update["reason"] == "조립 검증 결과가 불완전합니다."
    assert state["quote_draft"] is None


def test_retrieval_service_error_stops_downstream_calls(flow):
    services = Mock()
    services.retrieve.side_effect = ServiceUnavailable("synthetic outage")
    state = build_graph(services).invoke({"request": request()})
    flow.begin(
        "검색 서비스 장애",
        "그래프 오류 전파·후속 호출 차단",
        inputs={"request": request(), "exception": "ServiceUnavailable: synthetic outage"},
        mode="실제 LangGraph + 장애 주입 Mock",
        exclusions="실제 네트워크 장애 유발 안 함. 운영 서비스 변경 없음",
    )
    flow.equal("상태", "needs_revision", state["status"])
    flow.equal("원래 오류 사유 보존", True, "synthetic outage" in state["reason"])
    flow.equal("견적 생성 안 함", None, state["quote_draft"])
    flow.equal("카탈로그 호출 횟수", 0, services.catalog.call_count)
    flow.equal("검증기 호출 횟수", 0, services.validate.call_count)
    assert state["status"] == "needs_revision"
    assert "synthetic outage" in state["reason"]
    assert state["quote_draft"] is None
    services.catalog.assert_not_called()
    services.validate.assert_not_called()


@pytest.mark.parametrize("budget", [0, -1], ids=["zero-budget", "negative-budget"])
def test_invalid_user_input_does_not_reach_services(budget, flow):
    raw = {**request(), "budget_krw": budget}
    services = Mock()
    result = build_graph(services).invoke({"request": raw})
    flow.begin(
        "사용자 요청",
        "상담 입력 검증·서비스 호출 차단",
        inputs=raw,
        mode="실제 입력 계약·LangGraph + 외부 서비스 Mock",
        exclusions="사용자 등록 API·계정 인증·DB 입력은 아님",
    )
    flow.equal("상태", "needs_input", result["status"])
    flow.equal("오류 필드 안내", True, "budget_krw" in result["reason"])
    flow.equal("RAG 호출", 0, services.retrieve.call_count)
    flow.equal("카탈로그 호출", 0, services.catalog.call_count)
    flow.equal("검증기 호출", 0, services.validate.call_count)


def test_catalog_to_design_returns_selected_part_pk(flow):
    raw = {**request(), "categories": ["storage"]}
    state = nodes.consultation({"request": raw})
    product = {
        "part_id": 8,
        "category": "storage",
        "brand": "Fixture",
        "name": "TEST SSD",
        "currency": "KRW",
        "current_price": Decimal("10000.50"),
        "specs": {"capacity_gb": 500},
    }
    services = Mock()
    services.catalog.return_value = [product]
    result = nodes.design(state, services)
    flow.begin(
        "상담 조건",
        "카탈로그 조회 어댑터",
        inputs=raw,
        mode="실제 설계/선택 알고리즘 + 카탈로그 응답 Mock",
        exclusions="가상 상품 PK 8. 실제 DB 조회·가격 검증은 db-flow에서 별도",
    )
    flow.equal(
        "조회 분류·고정 PK",
        ((["storage"],), {"locked_ids": {8: 2}}),
        (services.catalog.call_args.args, services.catalog.call_args.kwargs),
    )
    flow.begin(
        "카탈로그 상품 후보",
        "설계 선택 결과",
        inputs={"products": [product]},
        mode="실제 선택 알고리즘 + 가상 데이터",
        exclusions="전체 PC 호환성 판정은 별도",
    )
    flow.equal("선택된 PK와 수량", {8: 2}, result["selection"])
    flow.equal("상품 정보 전달", [product], result["candidates"])
    flow.equal("고정 부품 선정 사유", True, "고정 부품" in result["selection_basis"][8])
