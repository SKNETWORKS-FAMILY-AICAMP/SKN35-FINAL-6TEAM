"""도메인 팩 인터페이스 — 공통 엔진과 도메인 지식의 경계입니다.

엔진(app/agents)은 이 인터페이스만 부릅니다. 상품 유형 이름, 사양 필드, 호환성 규칙처럼
특정 도메인에만 맞는 지식은 전부 팩 안에 둡니다.
"""

from typing import Any, Literal, Protocol

from pydantic import BaseModel

from app.catalog.records import ProductRecord

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

    def derive_preferences(self, purpose: str) -> Preferences:
        """사용 목적 문장에서 세부 조건을 추론합니다(상담팀이 씀)."""
        ...

    def score(
        self, product: ProductRecord, budget_max: int, prefs: Preferences
    ) -> ScoreResult | None:
        """설계팀용 점수. None 이면 후보에서 뺍니다(예: 예산 초과)."""
        ...

    def check(self, product: ProductRecord, budget_max: int, prefs: Preferences) -> list[Check]:
        """검증팀용 도메인 검사(사양 기준 · 호환성)."""
        ...
