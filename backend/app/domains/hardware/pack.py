"""하드웨어 도메인 팩 구현."""

import math
from pathlib import Path
from typing import Any

from app.catalog.records import ProductRecord
from app.contracts.schemas import Precision, VramEstimateOut, Workload
from app.domains.base import Check, DialogueContext, DialogueReply, Preferences, ScoreResult
from app.domains.hardware import dialogue
from app.domains.hardware.attributes import ATTRIBUTE_SCHEMAS, PRODUCT_TYPE_LABELS
from app.domains.hardware.cloud import load_cloud_prices
from app.domains.hardware.nlu import INTENTS, build_nlu
from app.domains.hardware.rules import (
    KNOWN_PREFERENCE_KEYS,
    PREFERENCE_RULES,
    PURPOSE_RULES,
    PreferenceRule,
)
from app.domains.hardware.sizing import estimate_vram
from app.nlu.base import NluPipeline, SlotValue

_OP_TEXT = {"min": "이상", "max": "이하", "equals": "필요"}


def _attribute_value(product: ProductRecord, rule: PreferenceRule) -> Any:
    for name in rule.attributes:
        if name in product.attributes:
            return product.attributes[name]
    return None


def _meets(value: Any, rule: PreferenceRule, wanted: Any) -> bool:
    if rule.op == "equals":
        return bool(value) == bool(wanted)
    try:
        number, target = float(value), float(wanted)
    except TypeError, ValueError:
        return False
    return number >= target if rule.op == "min" else number <= target


def model_estimate(prefs: Preferences) -> VramEstimateOut | None:
    """요구사항의 AI 모델 조건(model_params_b · precision · workload)으로 필요 VRAM 을 계산합니다."""
    if "model_params_b" not in prefs:
        if "precision" in prefs or "workload" in prefs:
            raise ValueError("precision · workload 는 model_params_b(모델 크기)와 함께 줘야 합니다")
        return None
    raw = prefs["model_params_b"]
    if isinstance(raw, bool) or not isinstance(raw, int | float) or raw <= 0:
        raise ValueError("model_params_b 는 0보다 큰 숫자여야 합니다(예: 7B → 7)")
    try:
        precision = Precision(str(prefs.get("precision", Precision.fp16.value)))
        workload = Workload(str(prefs.get("workload", Workload.inference.value)))
    except ValueError as exc:
        raise ValueError(
            "precision 은 fp32 · fp16 · int8 · int4, workload 는 inference · lora 중 하나여야 합니다"
        ) from exc
    return estimate_vram(float(raw), precision, workload)


def _describe(value: Any, rule: PreferenceRule, wanted: Any) -> str:
    if rule.op == "equals":
        have = "있음" if value else "없음"
        return f"{rule.label} {have} (조건: {rule.label} {_OP_TEXT['equals']})"
    return f"{rule.label} {value}{rule.unit} (조건 {wanted}{rule.unit} {_OP_TEXT[rule.op]})"


class HardwarePack:
    name = "hardware"

    def __init__(self) -> None:
        self._nlu = build_nlu()

    def product_types(self) -> dict[str, str]:
        return dict(PRODUCT_TYPE_LABELS)

    def preference_keys(self) -> frozenset[str]:
        return KNOWN_PREFERENCE_KEYS

    def normalize_attributes(self, product_type: str, attributes: dict[str, Any]) -> dict[str, Any]:
        schema = ATTRIBUTE_SCHEMAS.get(product_type)
        if schema is None:
            raise ValueError(f"하드웨어 팩이 모르는 상품 유형입니다: {product_type}")
        return schema.model_validate(attributes).model_dump(exclude_none=True)

    def derive_preferences(self, purpose: str, explicit: Preferences | None = None) -> Preferences:
        """사용 목적 문장 + AI 모델 조건으로 세부 조건을 추론합니다.

        모델 크기(model_params_b)가 있으면 사용 목적에서 어림한 VRAM 대신 계산한 필요 VRAM 을
        min_vram_gb 로 씁니다(더 구체적인 근거가 우선). 고객이 min_vram_gb 를 직접 줬다면 그 값이 이깁니다.
        """
        derived = self._purpose_preferences(purpose)
        estimate = model_estimate(explicit or {})
        if estimate is not None:
            derived["min_vram_gb"] = math.ceil(estimate.required_vram_gb)
        return derived

    def nlu(self) -> NluPipeline:
        return self._nlu

    def intent_labels(self) -> tuple[str, ...]:
        return INTENTS

    def parse_slot_value(self, slot: str, value: str) -> SlotValue:
        return dialogue.parse_slot_value(slot, value)

    def respond(self, context: DialogueContext) -> DialogueReply:
        return dialogue.respond(context)

    def check_reference_data(self, fixtures_dir: Path) -> list[str]:
        """카탈로그 밖의 도메인 기준 데이터(클라우드 GPU 가격 견본)를 검사합니다."""
        sheet = load_cloud_prices(fixtures_dir)
        return [f"클라우드 GPU 가격 견본 {len(sheet.offers)}개 형식 확인 ({sheet.data_status})"]

    def _purpose_preferences(self, purpose: str) -> Preferences:
        text = purpose.lower()
        derived: Preferences = {}
        for keywords, prefs in PURPOSE_RULES:
            if not any(word in text for word in keywords):
                continue
            for key, value in prefs.items():
                current = derived.get(key)
                if current is None:
                    derived[key] = value
                elif isinstance(value, bool):
                    derived[key] = bool(current) or value
                elif key.startswith("max_"):
                    derived[key] = min(float(current), float(value))
                else:
                    derived[key] = max(float(current), float(value))
        return derived

    def _applicable(self, product: ProductRecord, prefs: Preferences):
        for rule in PREFERENCE_RULES:
            if rule.key not in prefs:
                continue
            value = _attribute_value(product, rule)
            if value is None:
                continue  # 이 상품 유형에는 해당 없는 조건
            yield rule, value, prefs[rule.key]

    def score(
        self, product: ProductRecord, budget_max: int, prefs: Preferences
    ) -> ScoreResult | None:
        if product.price_amount is not None and product.price_amount > budget_max:
            return None
        score = 50.0
        reasons: list[str] = []
        for rule, value, wanted in self._applicable(product, prefs):
            if _meets(value, rule, wanted):
                score += 12
                reasons.append(_describe(value, rule, wanted))
            else:
                score -= 18
                reasons.append("미충족: " + _describe(value, rule, wanted))
        if product.price_amount is None:
            score -= 5
            reasons.append("가격 미확인")
        else:
            score += 10 * min(product.price_amount / budget_max, 1.0)
        return ScoreResult(score=round(score, 2), reasons=reasons)

    def check(self, product: ProductRecord, budget_max: int, prefs: Preferences) -> list[Check]:
        return [
            Check(
                code=rule.code,
                passed=_meets(value, rule, wanted),
                severity="block",
                detail=_describe(value, rule, wanted),
            )
            for rule, value, wanted in self._applicable(product, prefs)
        ]
