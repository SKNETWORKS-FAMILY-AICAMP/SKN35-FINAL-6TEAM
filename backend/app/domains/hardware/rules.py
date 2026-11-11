"""하드웨어 세부 조건 규칙 · 사용 목적 추론 규칙.

- 설계팀은 이 규칙으로 점수를 매기고(조건을 못 맞춰도 후보에서 바로 빼지 않음)
- 검증팀은 같은 규칙을 엄격하게 적용해 못 맞춘 후보를 탈락시킵니다.
"""

from dataclasses import dataclass
from typing import Literal

Op = Literal["min", "max", "equals"]


@dataclass(frozen=True)
class PreferenceRule:
    key: str  # 요구사항 preferences 의 키
    attributes: tuple[str, ...]  # 비교할 상품 사양 필드(앞에서부터 있는 것을 씀)
    op: Op  # min: 사양 ≥ 조건, max: 사양 ≤ 조건, equals: 같아야 함
    label: str
    unit: str
    code: str  # 검증 결과 코드
    kind: Literal["spec", "compat"] = "spec"


PREFERENCE_RULES: tuple[PreferenceRule, ...] = (
    PreferenceRule("min_ram_gb", ("ram_gb",), "min", "메모리", "GB", "SPEC_RAM"),
    PreferenceRule("min_storage_gb", ("storage_gb",), "min", "저장공간", "GB", "SPEC_STORAGE"),
    PreferenceRule(
        "min_vram_gb", ("vram_gb", "gpu_vram_gb"), "min", "그래픽 메모리", "GB", "SPEC_VRAM"
    ),
    PreferenceRule(
        "min_cpu_cores", ("cpu_cores", "cpu_cores_total"), "min", "CPU 코어", "개", "SPEC_CPU_CORES"
    ),
    PreferenceRule("max_weight_kg", ("weight_kg",), "max", "무게", "kg", "SPEC_WEIGHT"),
    PreferenceRule("min_refresh_hz", ("refresh_hz",), "min", "주사율", "Hz", "SPEC_REFRESH"),
    PreferenceRule(
        "min_size_inch", ("size_inch", "display_inch"), "min", "화면 크기", "인치", "SPEC_SIZE"
    ),
    PreferenceRule(
        "redundant_psu", ("redundant_psu",), "equals", "이중화 전원", "", "SPEC_PSU_REDUNDANT"
    ),
    # 호환성: 고객이 이미 가진 부품 정보와 비교합니다.
    PreferenceRule(
        "current_psu_w", ("recommended_psu_w",), "max", "권장 파워", "W", "COMPAT_PSU", "compat"
    ),
    PreferenceRule(
        "case_max_gpu_length_mm",
        ("length_mm",),
        "max",
        "그래픽카드 길이",
        "mm",
        "COMPAT_GPU_LENGTH",
        "compat",
    ),
    PreferenceRule("max_rack_u", ("rack_u",), "max", "랙 높이", "U", "COMPAT_RACK_U", "compat"),
)

KNOWN_PREFERENCE_KEYS = frozenset(rule.key for rule in PREFERENCE_RULES)

# 사용 목적 문장에 이 낱말이 있으면 조건을 추론합니다. 고객이 직접 준 값이 항상 우선합니다.
PURPOSE_RULES: tuple[tuple[tuple[str, ...], dict[str, int | float | bool]], ...] = (
    (("영상", "편집", "렌더"), {"min_ram_gb": 32, "min_vram_gb": 8}),
    (("게임", "게이밍"), {"min_vram_gb": 8, "min_refresh_hz": 144}),
    (("ai", "딥러닝", "머신러닝", "llm"), {"min_vram_gb": 16, "min_ram_gb": 32}),
    (("사무", "문서", "인강", "강의"), {"min_ram_gb": 8}),
    (("휴대", "가벼", "출장"), {"max_weight_kg": 1.5}),
    (("서버", "가상화", "데이터베이스"), {"min_ram_gb": 128, "redundant_psu": True}),
)
