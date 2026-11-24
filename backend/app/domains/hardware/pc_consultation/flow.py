"""Validate the incoming survey and derive the steps used by the consultation UI."""

from .catalog import CATEGORY_ORDER, LABELS


class InputError(ValueError):
    """The customer's request cannot be applied to this catalog or consultation."""


PROBLEMS = {
    "gaming": ("gpu", "게임 화면 끊김"),
    "multitasking": ("ram", "여러 프로그램 동시 사용"),
    "storage": ("storage", "저장 공간 부족"),
    "rendering": ("cpu", "편집·렌더링 지연"),
    "heat": ("cooler", "발열·소음"),
    "power": ("psu", "전원 불안정"),
}
PURPOSES = {"gaming": "게임", "image": "이미지 편집", "video": "영상 편집", "other": "일반 작업"}


def money(value, *, allow_zero=False):
    if type(value) is not int or not (0 if allow_zero else 1) <= value <= 1_000_000_000:
        raise InputError("금액은 10억원 이하의 원 단위 정수로 입력해 주세요.")
    return value


def category(value):
    if value not in CATEGORY_ORDER:
        raise InputError("부품 분류를 확인해 주세요.")
    return value


def part_ids(values):
    if not isinstance(values, dict):
        raise InputError("선택한 부품과 분류가 필요합니다.")
    for role, number in values.items():
        category(role)
        if type(number) is not int or not 0 < number < 2**64:
            raise InputError("부품 DB의 상품을 선택해 주세요.")
    return dict(values)


def owned(survey):
    if survey.get("mode") != "replacement":
        return {}
    entries = survey.get("owned") or {}
    if not isinstance(entries, dict):
        raise InputError("보유 부품 목록을 확인해 주세요.")
    result = {}
    for role, entry in entries.items():
        category(role)
        if not isinstance(entry, dict) or entry.get("category", role) != role:
            raise InputError("보유 부품의 분류를 확인해 주세요.")
        if entry.get("part_id") is not None:
            result[role] = entry["part_id"]
    return part_ids(result)


def steps(survey):
    money(survey.get("budget"))
    if survey.get("mode") == "new":
        return list(CATEGORY_ORDER), {}
    if survey.get("mode") != "replacement":
        raise InputError("신규 조립 또는 부품 교체를 선택해 주세요.")
    selected = survey.get("problems", [])
    reasons = {
        role: f"{label} 증상에 대해 {LABELS[role]} 교체 가능성을 확인합니다."
        for problem, (role, label) in PROBLEMS.items()
        if problem in selected
    }
    if not reasons:
        raise InputError("교체 대상을 정하려면 현재 겪는 문제를 선택해 주세요.")
    return list(reasons), reasons


def purpose(survey):
    labels = [PURPOSES[p] for p in survey.get("purposes", []) if p in PURPOSES]
    return ", ".join(labels) or "일반 작업"


def floors(survey):
    # These are catalog filtering preferences. They are never reported as benchmark results.
    purposes = survey.get("purposes", [])
    large = survey.get("workScale") == "large"
    cores = 8 if "video" in purposes else 6 if any(p != "other" for p in purposes) else 4
    vram = {"fhd": 6, "qhd": 8, "4k": 12}.get(survey.get("resolution"), 6)
    return {
        "cpu": ("cores", cores + 2 * large),
        "gpu": ("vram_gb", vram + 2 * (survey.get("frameRate") == "144")),
        "ram": ("capacity_gb", 32 if large else 16),
        "storage": ("capacity_gb", 1000 if large else 500),
    }


def criteria(survey):
    limits = floors(survey)
    return [
        f"후보 검색 기준 · CPU {limits['cpu'][1]}코어, GPU VRAM {limits['gpu'][1]} GB, "
        f"RAM {limits['ram'][1]} GB, 저장장치 {limits['storage'][1]} GB 이상",
        "가격은 DB에 기록된 기준 금액이며 목표 프레임·작업 속도는 실측 전까지 미확인입니다.",
    ]


def allocations(budget, roles, weights, locked=None):
    amounts = dict.fromkeys(CATEGORY_ORDER, 0)
    locked = locked or {}
    open_roles = [role for role in roles if role not in locked]
    amounts.update(locked)
    remaining = max(0, budget - sum(locked.values()))
    total_weight = sum(weights[role] for role in open_roles)
    for role in open_roles:
        amounts[role] = remaining * weights[role] // total_weight
    if open_roles:
        amounts[open_roles[-1]] += remaining - sum(amounts[k] for k in open_roles)
    return amounts
