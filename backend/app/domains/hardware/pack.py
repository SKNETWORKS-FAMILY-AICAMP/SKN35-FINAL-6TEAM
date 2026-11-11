"""하드웨어 도메인 팩 구현."""

from typing import Any

from app.catalog.records import ProductRecord
from app.domains.base import Check, Preferences, ScoreResult
from app.domains.hardware.attributes import ATTRIBUTE_SCHEMAS, PRODUCT_TYPE_LABELS
from app.domains.hardware.rules import (
    KNOWN_PREFERENCE_KEYS,
    PREFERENCE_RULES,
    PURPOSE_RULES,
    PreferenceRule,
)

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


def _describe(value: Any, rule: PreferenceRule, wanted: Any) -> str:
    if rule.op == "equals":
        have = "있음" if value else "없음"
        return f"{rule.label} {have} (조건: {rule.label} {_OP_TEXT['equals']})"
    return f"{rule.label} {value}{rule.unit} (조건 {wanted}{rule.unit} {_OP_TEXT[rule.op]})"


class HardwarePack:
    name = "hardware"

    def product_types(self) -> dict[str, str]:
        return dict(PRODUCT_TYPE_LABELS)

    def preference_keys(self) -> frozenset[str]:
        return KNOWN_PREFERENCE_KEYS

    def normalize_attributes(self, product_type: str, attributes: dict[str, Any]) -> dict[str, Any]:
        schema = ATTRIBUTE_SCHEMAS.get(product_type)
        if schema is None:
            raise ValueError(f"하드웨어 팩이 모르는 상품 유형입니다: {product_type}")
        return schema.model_validate(attributes).model_dump(exclude_none=True)

    def derive_preferences(self, purpose: str) -> Preferences:
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
