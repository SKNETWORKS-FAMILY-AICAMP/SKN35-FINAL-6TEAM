"""상담 발화 이해(NLU) 인터페이스 — 의도 분류(IntentClassifier) + 조건(슬롯) 추출(SlotExtractor).

지금은 규칙 기반 기준선(source="rules")만 있습니다. 3주차 학습 모델은 같은 두 인터페이스를 구현해
`NluPipeline(classifier, extractor)` 에 끼우면 채팅 · 평가 스크립트를 고치지 않고 바뀝니다(docs/ML_PLAN.md).

의도 이름 · 슬롯 이름 같은 도메인 지식은 여기 두지 않고 도메인 팩(app/domains/<팩>/nlu.py)에 둡니다.
"""

from dataclasses import dataclass, field
from typing import Any, Protocol

SlotValue = int | float | str | list[str]
Slots = dict[str, SlotValue]


@dataclass(frozen=True)
class IntentPrediction:
    intent: str
    confidence: float  # 0~1. 규칙 기준선은 점수 비율로 만든 근사값입니다(확률 보정 안 됨)


class IntentClassifier(Protocol):
    source: str  # "rules" | "model" ...

    def classify(self, text: str) -> IntentPrediction: ...


class SlotExtractor(Protocol):
    source: str

    def extract(self, text: str) -> Slots: ...


@dataclass(frozen=True)
class NluResult:
    intent: str
    confidence: float
    slots: Slots = field(default_factory=dict)
    source: str = "rules"

    def to_json(self) -> dict[str, Any]:
        return {
            "intent": self.intent,
            "confidence": self.confidence,
            "slots": dict(self.slots),
            "source": self.source,
        }


class NluPipeline:
    """분류기와 추출기를 묶습니다. 둘의 source 가 다르면 'model+rules' 처럼 함께 적습니다."""

    def __init__(self, classifier: IntentClassifier, extractor: SlotExtractor) -> None:
        self.classifier = classifier
        self.extractor = extractor
        sources = dict.fromkeys([classifier.source, extractor.source])
        self.source = "+".join(sources)

    def parse(self, text: str) -> NluResult:
        prediction = self.classifier.classify(text)
        return NluResult(
            intent=prediction.intent,
            confidence=round(prediction.confidence, 3),
            slots=self.extractor.extract(text),
            source=self.source,
        )
