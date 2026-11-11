"""상담팀: 고객 요구사항을 정리합니다.

지금: 화면에서 받은 값 + 사용 목적 문장의 낱말로 세부 조건을 추론(도메인 팩 규칙).
나중: 실시간 음성 대화 → LLM 이 RequirementsIn 형식으로 구조화 → 부족하면 추가 질문(needs_input).
"""

from typing import Any

from app.contracts.schemas import RequirementsIn
from app.domains.base import DomainPack


def structure_requirements(req: RequirementsIn, pack: DomainPack) -> dict[str, Any]:
    """요구사항 버전에 저장할 내용. 고객이 직접 준 조건이 추론한 조건보다 우선합니다."""
    derived = pack.derive_preferences(req.purpose)
    effective = {**derived, **req.preferences}
    return {
        "input": req.model_dump(mode="json"),
        "derived_preferences": derived,
        "effective_preferences": effective,
    }
