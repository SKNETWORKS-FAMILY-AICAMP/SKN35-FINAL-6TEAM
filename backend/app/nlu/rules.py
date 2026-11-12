"""규칙 기반 의도 분류기(공통 엔진). 낱말 표는 도메인 팩이 넘겨 줍니다.

점수 = 발화에 들어 있는 낱말들의 가중치 합(의도별). 가장 높은 의도를 고르고,
아무 낱말도 없으면 fallback 의도(보통 "other")로 답합니다.

신뢰도(confidence) = 1등 점수 ÷ (1등 점수 + 2등 점수 + 1)
  → 낱말이 많이 겹칠수록 · 2등과 차이가 클수록 1에 가까워집니다. 확률로 보정한 값이 아닙니다.
"""

from collections.abc import Sequence
from dataclasses import dataclass

from app.nlu.base import IntentPrediction

FALLBACK_CONFIDENCE = 0.3


@dataclass(frozen=True)
class IntentRule:
    intent: str
    keywords: tuple[str, ...]  # 소문자 · 공백 그대로 비교(부분 문자열)
    weight: float = 1.0


def normalize(text: str) -> str:
    return " ".join(text.lower().split())


class KeywordIntentClassifier:
    source = "rules"

    def __init__(
        self, rules: Sequence[IntentRule], priority: Sequence[str], fallback: str = "other"
    ) -> None:
        self.rules = tuple(rules)
        # 점수가 같을 때 앞에 있는 의도를 고릅니다.
        self.priority = {intent: rank for rank, intent in enumerate(priority)}
        self.fallback = fallback

    def scores(self, text: str) -> dict[str, float]:
        lowered = normalize(text)
        totals: dict[str, float] = {}
        for rule in self.rules:
            hits = sum(1 for word in rule.keywords if word in lowered)
            if hits:
                totals[rule.intent] = totals.get(rule.intent, 0.0) + hits * rule.weight
        return totals

    def classify(self, text: str) -> IntentPrediction:
        totals = self.scores(text)
        if not totals:
            return IntentPrediction(self.fallback, FALLBACK_CONFIDENCE)
        ranked = sorted(
            totals.items(), key=lambda kv: (-kv[1], self.priority.get(kv[0], len(self.priority)))
        )
        top_intent, top = ranked[0]
        second = ranked[1][1] if len(ranked) > 1 else 0.0
        return IntentPrediction(top_intent, top / (top + second + 1))
