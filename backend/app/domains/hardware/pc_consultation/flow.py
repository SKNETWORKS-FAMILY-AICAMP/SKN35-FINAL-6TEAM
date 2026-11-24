"""Validate the incoming survey and derive the steps used by the consultation UI."""

from .catalog import CATEGORY_ORDER


class InputError(ValueError):
    """The customer's request cannot be applied to this catalog or consultation."""


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
    reasons = survey.get("_design", {}).get("reasons", {})
    if not reasons:
        raise InputError("보유 부품과 증상에 대한 설계팀의 진단이 필요합니다.")
    return list(reasons), reasons


def purpose(survey):
    labels = [PURPOSES[p] for p in survey.get("purposes", []) if p in PURPOSES]
    return ", ".join(labels) or "일반 작업"


def allocations(budget, roles, weights, locked=None, *, minimums=None):
    amounts = dict.fromkeys(CATEGORY_ORDER, 0)
    locked = locked or {}
    open_roles = [role for role in roles if role not in locked]
    amounts.update(locked)
    remaining = max(0, budget - sum(locked.values()))
    minimums = minimums or {}
    minimum_total = sum(minimums.get(r, 0) for r in open_roles)
    if minimum_total <= remaining:
        remaining -= minimum_total
        amounts.update({r: minimums.get(r, 0) for r in open_roles})
    total_weight = sum(weights[role] for role in open_roles)
    for role in open_roles:
        amounts[role] += remaining * weights[role] // total_weight
    if open_roles:
        amounts[open_roles[-1]] += max(0, budget - sum(amounts.values()))
    return amounts
