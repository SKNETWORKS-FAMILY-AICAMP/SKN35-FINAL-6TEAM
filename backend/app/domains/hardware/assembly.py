"""Evaluate an assembled PC against the specs of its selected parts."""

import re
from collections import defaultdict
from dataclasses import dataclass
from typing import Any, Literal

Result = Literal["PASS", "FAIL", "CONDITIONAL", "UNKNOWN"]

# Portfolio policy for one discrete GPU at stock settings. Both inputs and the
# result describe capacity planning, independent of cable or transient checks.
DEFAULT_OTHER_LOAD_W = 75
PSU_HEADROOM_PERCENT = 25


@dataclass(frozen=True)
class AssemblyPart:
    part_id: int
    name: str
    category: str
    specs: dict[str, Any]
    quantity: int = 1

    def positive(self, field: str) -> int | None:
        value = self.specs.get(field)
        return value if type(value) is int and value > 0 else None


@dataclass(frozen=True)
class AssemblyCheck:
    check_type: str
    result: Result
    reason: str
    compatibility_ids: tuple[int, ...] = ()


def _cpu_support(board, cpu, evidence, bios_version):
    code = "CPU_SUPPORT"
    if not board or not cpu:
        return AssemblyCheck(code, "UNKNOWN", "CPU와 메인보드를 각각 하나 선택해야 합니다.")
    a, b = board.specs.get("socket"), cpu.specs.get("socket")
    if (
        isinstance(a, str)
        and isinstance(b, str)
        and a.replace(" ", "").upper() != b.replace(" ", "").upper()
    ):
        return AssemblyCheck(code, "FAIL", f"메인보드 소켓 {a} / CPU 소켓 {b}")
    rows = [
        row
        for row in evidence
        if row["check_type"] == code
        and (row["part_a_id"], row["part_b_id"]) == (board.part_id, cpu.part_id)
    ]
    if len(rows) != 1:
        return AssemblyCheck(
            code, "UNKNOWN", "이 조합의 제조사 CPU 지원 근거를 하나로 확인할 수 없습니다."
        )
    row = rows[0]
    ids = (row["compatibility_id"],)
    if row["support_status"] == "UNSUPPORTED":
        return AssemblyCheck(code, "FAIL", "제조사 지원 목록에서 미지원으로 확인됐습니다.", ids)
    if row["bios_scope"] == "MIN_VERSION":
        minimum = row["min_bios_version"]
        if bios_version and bios_version.upper() == minimum.upper():
            return AssemblyCheck(
                code, "PASS", f"설치 BIOS {bios_version}이 최소 지원 버전과 일치합니다.", ids
            )
        return AssemblyCheck(
            code,
            "CONDITIONAL",
            f"BIOS {minimum} 이상 필요. 설치 버전 또는 공식 버전 순서를 확인하세요.",
            ids,
        )
    conditions = row.get("conditions", {})
    if supported_bios := conditions.get("known_supported_bios"):
        return AssemblyCheck(
            code,
            "CONDITIONAL",
            f"제조사 릴리스에서 BIOS {supported_bios}의 지원을 확인했습니다. 최소 지원 버전은 미확인입니다.",
            ids,
        )
    if conditions.get("support_evidence") == "official_bundle":
        return AssemblyCheck(
            code, "CONDITIONAL", "제조사 공식 번들 조합입니다. 최소 지원 BIOS는 미확인입니다.", ids
        )
    if row["support_status"] == "SUPPORTED":
        return AssemblyCheck(code, "PASS", "제조사 CPU 지원 근거를 확인했습니다.", ids)
    return AssemblyCheck(code, "CONDITIONAL", "제조사가 명시한 지원 조건을 확인하세요.", ids)


def _memory_standard(board, kits, code, field, allowed):
    standard = board.specs.get(field)
    options = [part.specs.get(field) for part in kits]
    if not isinstance(standard, str) or standard not in allowed:
        return AssemblyCheck(code, "UNKNOWN", "메인보드 규격을 확인할 수 없습니다.")
    known = [item for item in options if isinstance(item, str) and item in allowed]
    if incompatible := sorted(set(known) - {standard}):
        return AssemblyCheck(
            code, "FAIL", f"메인보드 {standard} / 불일치 RAM {', '.join(incompatible)}"
        )
    if len(known) != len(options):
        return AssemblyCheck(code, "UNKNOWN", "일부 RAM의 규격을 확인할 수 없습니다.")
    return AssemblyCheck(code, "PASS", f"메인보드와 RAM의 {standard} 규격이 일치합니다.")


def _memory_total(kits, code, field, limit, unit):
    values = [kit.positive(field) for kit in kits]
    known_total = sum(
        value * kit.quantity for value, kit in zip(values, kits, strict=True) if value
    )
    if limit and known_total > limit:
        return AssemblyCheck(code, "FAIL", f"확인된 합계 {known_total}{unit} / 한도 {limit}{unit}")
    if not limit or None in values:
        return AssemblyCheck(
            code, "UNKNOWN", "메인보드 한도 또는 일부 RAM 키트 사양을 확인할 수 없습니다."
        )
    return AssemblyCheck(code, "PASS", f"합계 {known_total}{unit} / 한도 {limit}{unit}")


def _memory_qvl(board, cpu, kits, evidence):
    code = "RAM_QVL"
    if len(kits) != 1 or kits[0].quantity != 1:
        return AssemblyCheck(code, "UNKNOWN", "현재 RAM QVL 근거는 키트 1개 구성에 적용됩니다.")
    family = cpu.specs.get("cpu_family") if cpu else None
    series = cpu.specs.get("cpu_series") if cpu else None
    families = {value for value in (family, series) if value}
    ids = tuple(
        row["compatibility_id"]
        for row in evidence
        if row["check_type"] == "MEMORY_QVL"
        and (row["part_a_id"], row["part_b_id"]) == (board.part_id, kits[0].part_id)
        and row["conditions"].get("cpu_family") in families
        and row["conditions"].get("kits") == 1
        and row["support_status"] == "CONDITIONAL"
    )
    if ids:
        return AssemblyCheck(
            code,
            "CONDITIONAL",
            f"{family or series}와 키트 1개의 제조사 QVL 근거가 있습니다. 적용 속도와 BIOS를 확인하세요.",
            ids,
        )
    return AssemblyCheck(code, "UNKNOWN", "이 보드·CPU 계열·RAM 키트에 맞는 QVL 근거가 없습니다.")


def _memory_checks(board, cpu, kits, evidence):
    if not board or not kits:
        return [
            AssemblyCheck(code, "UNKNOWN", "메인보드 한 개와 RAM이 필요합니다.")
            for code in ("RAM_TYPE", "RAM_FORM_FACTOR", "RAM_SLOTS", "RAM_CAPACITY", "RAM_QVL")
        ]
    capacity_limits = [
        limit for part in (board, cpu) if part and (limit := part.positive("ram_max_gb"))
    ]
    return [
        _memory_standard(
            board, kits, "RAM_TYPE", "ram_type", frozenset(f"DDR{i}" for i in range(1, 6))
        ),
        _memory_standard(board, kits, "RAM_FORM_FACTOR", "ram_form_factor", {"DIMM", "SO-DIMM"}),
        _memory_total(kits, "RAM_SLOTS", "modules_per_item", board.positive("memory_slots"), "개"),
        _memory_total(
            kits,
            "RAM_CAPACITY",
            "capacity_gb",
            min(capacity_limits, default=None) if board.positive("ram_max_gb") else None,
            "GB",
        ),
        _memory_qvl(board, cpu, kits, evidence),
    ]


def _gpu_clearance(case, gpu, front_radiator_mm):
    code = "GPU_CLEARANCE"
    if not case or not gpu:
        return AssemblyCheck(code, "UNKNOWN", "케이스와 그래픽카드를 각각 하나 선택해야 합니다.")
    length = gpu.positive("length_mm")
    base_limit = case.positive("max_gpu_length_mm")
    if not length or not base_limit:
        return AssemblyCheck(code, "UNKNOWN", "그래픽카드 길이 또는 케이스 허용 길이가 없습니다.")
    if length > base_limit:
        return AssemblyCheck(code, "FAIL", f"카드 {length}mm / 기본 케이스 한도 {base_limit}mm")
    limit = base_limit
    setup = "전면 라디에이터 없는 기본 배치"
    if front_radiator_mm is not None:
        setup = f"전면 {front_radiator_mm}mm 라디에이터"
        limits = case.specs.get("gpu_clearance_by_front_radiator_mm", {})
        limit = limits.get(str(front_radiator_mm)) if isinstance(limits, dict) else None
        if type(limit) is not int or limit <= 0:
            return AssemblyCheck(
                code, "UNKNOWN", f"{setup} 장착 시 케이스의 GPU 허용 길이가 없습니다."
            )
    return AssemblyCheck(
        code,
        "PASS" if length <= limit else "FAIL",
        f"{setup} 기준 카드 {length}mm / 한도 {limit}mm",
    )


def _power_capacity(cpu, gpu, psu, other_load_w):
    code = "PSU_CAPACITY"
    if not cpu or not gpu or not psu:
        return AssemblyCheck(code, "UNKNOWN", "CPU·외장 GPU·파워를 각각 하나 선택해야 합니다.")
    watts = psu.positive("wattage_w")
    cpu_limit, gpu_power = cpu.positive("cpu_power_limit_w"), gpu.positive("gpu_power_w")
    recommended = gpu.positive("recommended_psu_w")
    estimate = None
    if cpu_limit and gpu_power:
        load = cpu_limit + gpu_power + other_load_w
        estimate = (load * (100 + PSU_HEADROOM_PERCENT) + 99) // 100
    thresholds = [value for value in (recommended, estimate) if value is not None]
    power_text = f"파워 {watts}W" if watts else "파워 정격 미확인"
    if recommended:
        power_text += f", GPU 제조사 권장 {recommended}W"
    if estimate is not None:
        power_text += f", 시스템 추정 {estimate}W (CPU {cpu_limit}W + GPU {gpu_power}W + 기타 {other_load_w}W에 여유 {PSU_HEADROOM_PERCENT}%)"
    if not watts or not thresholds:
        return AssemblyCheck(code, "UNKNOWN", power_text + ". 비교에 필요한 전력값이 없습니다.")
    if watts < max(thresholds):
        return AssemblyCheck(
            code, "FAIL", power_text + f". 필요 기준 {max(thresholds)}W에 미달합니다."
        )
    if estimate is None or not recommended:
        return AssemblyCheck(
            code, "CONDITIONAL", power_text + ". 나머지 전력 기준을 확인해야 합니다."
        )
    return AssemblyCheck(code, "PASS", power_text + f". 필요 기준 {max(thresholds)}W를 충족합니다.")


def validate_assembly(
    parts: list[AssemblyPart],
    evidence: list[dict[str, Any]],
    *,
    bios_version: str | None = None,
    front_radiator_mm: int | None = None,
    other_load_w: int = DEFAULT_OTHER_LOAD_W,
) -> list[AssemblyCheck]:
    """Return separate verdicts for each check, including unavailable evidence."""
    if other_load_w < 0 or (front_radiator_mm is not None and front_radiator_mm <= 0):
        raise ValueError("기타 소비전력과 전면 라디에이터 크기를 확인하세요.")
    if bios_version and not re.fullmatch(r"[A-Za-z0-9._-]{1,50}", bios_version):
        raise ValueError("BIOS 버전 표기를 확인하세요.")
    grouped = defaultdict(list)
    for part in parts:
        if part.quantity < 1:
            raise ValueError("부품 수량은 양수여야 합니다.")
        grouped[part.category].append(part)

    def single(category):
        entries = grouped[category]
        return entries[0] if len(entries) == 1 and entries[0].quantity == 1 else None

    cpu, board, gpu, case, psu = (
        single(role) for role in ("cpu", "motherboard", "gpu", "case", "psu")
    )
    return [
        _cpu_support(board, cpu, evidence, bios_version),
        *_memory_checks(board, cpu, grouped["ram"], evidence),
        _gpu_clearance(case, gpu, front_radiator_mm),
        _power_capacity(cpu, gpu, psu, other_load_w),
    ]
