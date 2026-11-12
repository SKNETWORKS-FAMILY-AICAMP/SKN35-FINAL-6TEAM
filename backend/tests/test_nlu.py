"""DB 없이 도는 테스트: NLU 지표 · 평가셋 형식 · 규칙 기준선 · 슬롯 추출 규칙."""

import re
from collections import Counter

import pytest

from app.core.config import Settings
from app.domains.hardware.nlu import INTENTS, PURPOSES, build_nlu
from app.domains.hardware.pack import HardwarePack
from app.nlu.evaluate import evaluate, load_examples
from app.nlu.metrics import intent_report, slot_pairs, slot_report

EVAL_FILE = Settings().nlu_data_dir / "hardware_eval_v1.jsonl"
NLU = build_nlu()
SLOT_NAMES = {
    "budget_max",
    "purpose",
    "model_params_b",
    "precision",
    "product_types",
    "owned_device",
    "owned_ram_gb",
    "owned_vram_gb",
    "weekly_hours",
}


def test_intent_metrics_on_toy_data() -> None:
    report = intent_report(["a", "a", "b", "b"], ["a", "b", "b", "b"], ("a", "b"))
    assert report.accuracy == 0.75
    assert report.per_intent["a"].precision == 1.0 and report.per_intent["a"].recall == 0.5
    assert report.per_intent["b"].f1 == 0.8
    assert report.macro_f1 == round((2 / 3 + 0.8) / 2, 4)
    assert report.confusion[("a", "b")] == 1


def test_slot_metrics_treat_numbers_and_lists_fairly() -> None:
    assert slot_pairs({"model_params_b": 7}) == slot_pairs({"model_params_b": 7.0})
    assert slot_pairs({"product_types": ["gpu", "laptop"]}) == slot_pairs(
        {"product_types": ["laptop", "gpu"]}
    )
    report = slot_report(
        [{"budget_max": 2_000_000, "product_types": ["laptop"]}, {}],
        [{"budget_max": 2_000_000, "product_types": ["laptop", "monitor"]}, {"purpose": "x"}],
    )
    assert report.micro.precision == 0.5 and report.micro.recall == 1.0
    assert report.exact_match == 0.0


def test_eval_set_is_balanced_and_well_formed() -> None:
    examples = load_examples(EVAL_FILE)
    assert len(examples) >= 60
    counts = Counter(e.intent for e in examples)
    assert set(counts) == set(INTENTS)
    assert min(counts.values()) >= 10, counts
    for e in examples:
        assert set(e.slots) <= SLOT_NAMES, e.id
        if "purpose" in e.slots:
            assert e.slots["purpose"] in PURPOSES, e.id
        # 가상 발화만 — 연락처 · 이메일 같은 개인정보가 없어야 합니다
        assert not re.search(r"\d{2,3}-\d{3,4}-\d{4}|@", e.text), e.id


def test_rule_baseline_stays_above_floor() -> None:
    """규칙 기준선의 회귀 방지 하한. 측정값(docs/ML_PLAN.md)보다 낮게 잡았습니다 — 점수를 맞추려고 고치지 않습니다."""
    examples = load_examples(EVAL_FILE)
    result = evaluate(HardwarePack().nlu(), examples, INTENTS)
    assert result.source == "rules"
    assert result.intents.accuracy >= 0.85
    assert result.intents.macro_f1 >= 0.85
    assert result.slots.micro.f1 >= 0.85


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("예산은 2천만 원입니다", {"budget_max": 20_000_000}),
        ("1,500,000원 안쪽이요", {"budget_max": 1_500_000}),
        ("100만원에서 150만원 사이", {"budget_max": 1_500_000}),
        ("70억 파라미터 모델", {"model_params_b": 7}),
        ("FP16 말고 4비트로 해 볼게요", {"precision": "int4"}),
        ("8비트 양자화", {"precision": "int8"}),
        ("하루 2시간씩 써요", {"weekly_hours": 14}),
        ("한 달에 40시간", {"weekly_hours": 9.2}),
    ],
)
def test_slot_rules(text: str, expected: dict) -> None:
    slots = NLU.parse(text).slots
    for name, value in expected.items():
        assert slots.get(name) == value, (text, slots)


def test_hourly_price_is_not_a_budget() -> None:
    slots = NLU.parse("클라우드 GPU 시간당 1,200원이면 싼 건가요?").slots
    assert "budget_max" not in slots


def test_owned_device_vs_product_to_buy() -> None:
    owned = NLU.parse("제 노트북 램 16기가인데 업그레이드하면 7B 돌릴 수 있을까요?")
    assert owned.intent == "upgrade_diagnosis"
    assert owned.slots["owned_device"] == "laptop" and owned.slots["owned_ram_gb"] == 16
    assert "product_types" not in owned.slots

    buy = NLU.parse("LLM 파인튜닝용 노트북 추천해 주세요, 예산 300만원")
    assert buy.intent == "new_recommendation"
    assert buy.slots == {
        "budget_max": 3_000_000,
        "purpose": "llm_finetune",
        "product_types": ["laptop"],
    }
    assert 0 < buy.confidence <= 1 and buy.source == "rules"


def test_no_keyword_falls_back_to_other_with_low_confidence() -> None:
    result = NLU.parse("음...")
    assert result.intent == "other" and result.confidence == 0.3
