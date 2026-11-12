"""도메인 팩 인터페이스 — 공통 엔진과 도메인 지식의 경계입니다.

엔진(app/agents)은 이 인터페이스만 부릅니다. 상품 유형 이름, 사양 필드, 호환성 규칙처럼
특정 도메인에만 맞는 지식은 전부 팩 안에 둡니다.
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, Protocol

from pydantic import BaseModel

from app.catalog.records import ProductRecord
from app.contracts.schemas import QuickReplyOut, RequirementsIn
from app.nlu.base import NluPipeline, Slots, SlotValue

Severity = Literal["info", "warn", "block"]
Preferences = dict[str, int | float | bool | str]


class ScoreResult(BaseModel):
    score: float
    reasons: list[str]


class Check(BaseModel):
    code: str
    passed: bool
    severity: Severity
    detail: str


@dataclass(frozen=True)
class DialogueContext:
    """채팅 상담에서 도메인 팩이 다음 답을 정할 때 받는 것."""

    intent: str  # 이번 메시지까지 반영한 의도(선택지로 바꾼 의도 포함)
    slots: Slots  # 지금까지 대화에서 모은 조건(뒤에 말한 값이 우선)
    supported_product_types: list[str]  # 이 기업이 취급하는 상품 유형
    has_quotation: bool  # 현재 요구사항 버전의 참고 견적이 있는지
    catalog: Callable[[], list[ProductRecord]]  # 이 기업 상품(필요할 때만 읽음)
    fixtures_dir: Path


@dataclass(frozen=True)
class DialogueReply:
    text: str
    quick_replies: list[QuickReplyOut] = field(default_factory=list)
    requirements: RequirementsIn | None = None  # 채워지면 요구사항 새 버전 → 업무팀 실행


class DomainPack(Protocol):
    name: str

    def product_types(self) -> dict[str, str]:
        """상품 유형 코드 → 화면에 보일 이름."""
        ...

    def preference_keys(self) -> frozenset[str]:
        """요구사항 preferences 에 쓸 수 있는 키. 모르는 키는 오타일 수 있어 거절합니다."""
        ...

    def normalize_attributes(self, product_type: str, attributes: dict[str, Any]) -> dict[str, Any]:
        """상품 유형별 사양 스키마로 검사·정리합니다. 틀리면 ValueError."""
        ...

    def derive_preferences(self, purpose: str, explicit: Preferences | None = None) -> Preferences:
        """사용 목적 문장(과 고객이 준 조건)에서 세부 조건을 추론합니다(상담팀이 씀). 값이 틀리면 ValueError."""
        ...

    def nlu(self) -> NluPipeline:
        """상담 발화 이해(의도 분류 + 슬롯 추출). 지금은 규칙 기준선, 3주차에 학습 모델로 바꿔 끼웁니다."""
        ...

    def intent_labels(self) -> tuple[str, ...]:
        """이 도메인 상담의 의도 이름 목록(평가 · 라벨 기준)."""
        ...

    def parse_slot_value(self, slot: str, value: str) -> SlotValue:
        """선택지(Quick Reply)로 온 슬롯 값을 검사 · 변환합니다. 틀리면 ValueError."""
        ...

    def respond(self, context: DialogueContext) -> DialogueReply:
        """채팅 상담의 다음 답: 빠진 조건 되묻기 · 진단 · 비교 · 요구사항 확정."""
        ...

    def check_reference_data(self, fixtures_dir: Path) -> list[str]:
        """카탈로그 밖의 도메인 기준 데이터 형식을 검사하고 결과 줄을 돌려줍니다. 틀리면 ValueError."""
        ...

    def score(
        self, product: ProductRecord, budget_max: int, prefs: Preferences
    ) -> ScoreResult | None:
        """설계팀용 점수. None 이면 후보에서 뺍니다(예: 예산 초과)."""
        ...

    def check(self, product: ProductRecord, budget_max: int, prefs: Preferences) -> list[Check]:
        """검증팀용 도메인 검사(사양 기준 · 호환성)."""
        ...
