"""Exercise the live-call boundary without any credentials or external requests."""

import json
from urllib.error import HTTPError

import pytest

from app.domains.hardware.pc_consultation import advisor
from app.domains.hardware.pc_consultation.reviewed_documents import document, manufacturer_points
from app.rag.loader import load_corpus
from app.rag.points import build_points


def response(**overrides):
    answer = {
        "text": "GPU에 사용할 금액을 알려 주세요.",
        "grounding": "clarification",
        "intent": "ask_gpu_budget",
        "amount": None,
        "citations": [],
        **overrides,
    }
    return {
        "status": "completed",
        "id": "resp_test",
        "model": "gpt-5-mini-test",
        "output": [
            {
                "type": "message",
                "role": "assistant",
                "content": [{"type": "output_text", "text": json.dumps(answer)}],
            }
        ],
    }


@pytest.fixture
def offline(monkeypatch):
    monkeypatch.setenv("BUILDWISE_CONSULTATION_PROVIDER", "openai")
    points = [*build_points(load_corpus()), *manufacturer_points()]
    monkeypatch.setenv("OPENAI_API_KEY", "fixture-key-not-a-credential")
    monkeypatch.setattr(advisor, "_index", lambda: (points, None, None))


def test_actual_release_search_and_trusted_source_attachment(offline, monkeypatch):
    key = "BW20261119:CHK-HW19-014"

    def provider(token, request):
        assert token == "fixture-key-not-a-credential"
        assert request["model"] == "gpt-5-mini"
        assert request["text"]["format"]["strict"] and not request["store"]
        assert token not in json.dumps(request)
        data = json.loads(request["input"])
        assert key in [s["chunk_key"] for s in data["evidence"]]
        return response(
            text="CB16GS4800은 노트북용 262핀 SO-DIMM입니다.",
            intent="chat",
            grounding="documents",
            citations=[key],
        )

    monkeypatch.setattr(advisor, "_request_openai", provider)
    result = advisor.advise("CB16GU4800과 CB16GS4800 중 노트북에 쓸 모델이 뭔가요?", {}, [])
    assert result["retrieval_mode"] == "keyword"
    assert result["response_id"] == "resp_test"
    assert [s["chunk_key"] for s in result["sources"]] == [key]
    assert result["sources"][0]["url"].startswith("https://content.crucial.com/")


@pytest.mark.parametrize(
    ("question", "key"),
    [
        ("MONTECH APX 650W ATX 파워 길이와 규격", "POWER:MONTECH-APX-650W"),
        ("Peerless Assassin 120 SE DTPC 열 시험대 125~260 W", "THERMALRIGHT:PA120-SE:DTPC"),
        (
            "ASUS TUF GAMING B850-PLUS WIFI Ryzen 7000 CT32G48C40U5.M16A1 메모리 QVL",
            "ASUS:B850-PLUS-WIFI:RYZEN7000:CT32G48C40U5.M16A1",
        ),
    ],
)
def test_manufacturer_passages_searchable_without_quote_and_unique_in_quote(offline, question, key):
    _, results = advisor._retrieve(question, {})
    assert document(key) in results
    _, with_selection = advisor._retrieve(question, {"check_documents": [document(key)]})
    assert [row["chunk_key"] for row in with_selection].count(key) == 1


def test_current_build_passage_can_be_cited_but_is_not_carried_into_another_quote(
    offline, monkeypatch
):
    from app.domains.hardware.pc_consultation.fit_documents import supplement_checks

    selected = {
        "case": dict(
            category="case",
            brand="NZXT",
            model_number="H5 Flow (2024) Black",
            source_key="case-nzxt-h5-flow-2024-black",
            specs={"color": "Black"},
        ),
        "cooler": dict(
            category="cooler",
            brand="Thermalright",
            model_number="Peerless Assassin 120 SE",
            source_key="cooler-thermalright-peerless-assassin-120-se",
            specs={"height_mm": 155, "color": "Black / Silver"},
        ),
    }
    checks = supplement_checks(
        selected, [{"check_type": "COOLER_CLEARANCE", "result": "UNKNOWN", "reason": "미확인"}]
    )
    case, cooler = checks[0]["sources"]
    context = {"check_documents": [case, cooler]}
    question = "선택한 케이스에서 이 CPU 쿨러가 들어가는 근거를 알려주세요."

    def provider(token, request):
        prompt = json.loads(request["input"])
        assert "check_documents" not in prompt["current"]
        evidence = {s["chunk_key"]: s for s in prompt["evidence"]}
        assert "170" in evidence[case["chunk_key"]]["text"]
        assert "155" in evidence[cooler["chunk_key"]]["text"]
        return response(
            text="케이스 허용 높이는 170 mm, 쿨러 기본 높이는 155 mm입니다.",
            intent="chat",
            grounding="documents",
            citations=[case["chunk_key"], cooler["chunk_key"]],
        )

    monkeypatch.setattr(advisor, "_request_openai", provider)
    result = advisor.advise(question, context, [])
    assert result["sources"] == [case, cooler]
    _, other_sources = advisor._retrieve(question, {})
    assert {source["chunk_key"] for source in other_sources}.isdisjoint(
        [case["chunk_key"], cooler["chunk_key"]]
    )


def test_quote_retrieval_excludes_other_cooler_but_allows_an_explicit_comparison(offline):
    context = {
        "check_documents": [{"chunk_key": "selected-cooler"}],
        "selected": {"쿨러": {"name": "Thermalright Peerless Assassin 120 SE"}},
    }
    passages = {p.payload["chunk_key"]: p.payload for p in advisor._index()[0]}
    noctua = passages["BW20261119:CHK-HW19-020"]
    assert not advisor._matches_quote_or_question(noctua, "지금 선택한 쿨러 높이는?", context)
    assert advisor._matches_quote_or_question(noctua, "NH-D15 G2로 바꾸면 높이는?", context)
    crucial = passages["BW20261119:CHK-HW19-014"]
    assert advisor._matches_quote_or_question(crucial, "CB16GS4800은 어떤 규격인가요?", context)


def test_explicit_white_case_request_produces_preview_with_conversational_answer(
    offline, monkeypatch
):
    monkeypatch.setattr(
        advisor,
        "_request_openai",
        lambda *_: response(
            text="검증된 화이트 케이스 변경안을 확인해 보세요.",
            grounding="catalog",
            intent="chat",
        ),
    )
    for request in ("케이스를 화이트로 바꿔 줘", "화이트 케이스로 바꿔 주세요"):
        assert advisor.advise(request, {}, [])["intent"] == "white_case"
    assert advisor.advise("케이스를 화이트로 바꾸지 마세요", {}, [])["intent"] == "chat"


def test_staging_is_limited_to_reviewed_profiles_for_the_named_game(offline):
    _, sources = advisor._retrieve("배틀필드 6는 어떤 권장 사양이 있나요?", {})
    reviewed = [s for s in sources if s["chunk_key"].startswith("BW20261119FIT:")]
    assert {s["chunk_key"] for s in reviewed} == {
        "BW20261119FIT:CHK-FIT-001",
        "BW20261119FIT:CHK-FIT-002",
        "BW20261119FIT:CHK-FIT-003",
    }
    assert all(s["url"].startswith("https://www.ea.com/") for s in reviewed)


@pytest.mark.parametrize(
    ("question", "awaiting", "stated", "intent", "amount"),
    [
        ("GPU에는 45만원", False, 450000, "gpu_budget", 450000),
        ("45만 원으로", True, 450000, "gpu_budget", 450000),
        ("450,000", True, 450000, "gpu_budget", 450000),
        ("전체 예산은 45만원", True, 450000, "chat", None),
        ("GPU를 바꾸고 싶어요. 총 예산은 80만원", False, 800000, "ask_gpu_budget", None),
        ("총 예산은 80만원이고 GPU엔 35만 원", False, 350000, "gpu_budget", 350000),
        ("GPU는 40만원까지", False, 800000, "ask_gpu_budget", None),
    ],
)
def test_gpu_intent_cannot_invent_money_or_spend_the_total_budget(
    question, awaiting, stated, intent, amount
):
    proposed = advisor._Reply(
        text="예산 확인",
        grounding="clarification",
        intent="gpu_budget",
        amount=stated,
        citations=[],
    )
    assert advisor._budget_intent(proposed, question, {"awaiting_gpu_budget": awaiting}) == (
        intent,
        amount,
    )


@pytest.mark.parametrize(
    "answer",
    [
        response(citations=["other"], grounding="documents"),
        response(grounding="documents"),
        {**response(), "status": "incomplete"},
        {
            **response(),
            "output": [{"type": "message", "role": "assistant", "content": [{"type": "refusal"}]}],
        },
    ],
)
def test_incomplete_refused_and_ungrounded_replies_fail(offline, monkeypatch, answer):
    monkeypatch.setattr(advisor, "_request_openai", lambda *_: answer)
    with pytest.raises(advisor.AdvisorError):
        advisor.advise("RAM은 무엇을 선택할까요?", {}, [])


def test_nonexistent_inventory_source_cannot_authorize_a_stock_claim(offline, monkeypatch):
    monkeypatch.setattr(
        advisor,
        "_request_openai",
        lambda *_: response(grounding="catalog", text="매장 재고는 5개입니다."),
    )
    with pytest.raises(advisor.AdvisorError, match="재고"):
        advisor.advise("오늘 매장 재고는 몇 개인가요?", {}, [])


def test_no_api_key_stops_before_attempting_a_call(monkeypatch):
    monkeypatch.setenv("BUILDWISE_CONSULTATION_PROVIDER", "openai")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setattr(advisor, "dotenv_values", lambda *_args, **_kwargs: {})
    with pytest.raises(advisor.AdvisorError, match="OPENAI_API_KEY"):
        advisor.advise("안녕하세요", {}, [])


def test_provider_error_only_exposes_status(monkeypatch):
    def reject(request, *, timeout):
        assert 0 < timeout <= 60
        assert request.unredirected_hdrs["Authorization"] == "Bearer test-token"
        raise HTTPError(request.full_url, 401, "mock secret details", {}, None)

    monkeypatch.setattr(advisor, "urlopen", reject)
    with pytest.raises(advisor.AdvisorError, match="401") as exc:
        advisor._request_openai("test-token", {})
    assert "secret" not in str(exc.value) and "test-token" not in str(exc.value)
