"""Choose a priced catalog assembly and repair one implicated part at a time."""

from collections import defaultdict
from decimal import Decimal, InvalidOperation

from app.domains.hardware.assembly import DEFAULT_OTHER_LOAD_W, AssemblyPart, validate_assembly

_SINGLE = {"cpu", "motherboard", "gpu", "case", "psu"}
_REPAIR_ROLES = {
    "PSU_CAPACITY": ("psu",),
    "GPU_CLEARANCE": ("case", "gpu"),
    "CPU_SUPPORT": ("motherboard", "cpu"),
    "RAM_TYPE": ("ram", "motherboard"),
    "RAM_FORM_FACTOR": ("ram", "motherboard"),
    "RAM_SLOTS": ("ram", "motherboard"),
    "RAM_CAPACITY": ("ram", "motherboard", "cpu"),
}


def _matches(actual, expected) -> bool:
    if isinstance(actual, str) and isinstance(expected, str):
        return actual.strip().casefold() == expected.strip().casefold()
    if isinstance(actual, bool) or isinstance(expected, bool):
        return actual is expected
    return actual is not None and actual == expected


def _criteria(row, req, priority):
    category = row["category"]
    brand = req.get(f"{priority}_brands", {}).get(category)
    if brand is not None:
        yield f"브랜드={brand}", _matches(row["brand"], brand)
    for key, expected in req.get(f"{priority}_specs", {}).get(category, {}).items():
        if key == "model_number":
            # MySQL stores identifiers with a binary collation.
            matches = row.get(key) is not None and row[key] == expected
        else:
            value = row.get("name") if key == "name" else row["specs"].get(key)
            matches = _matches(value, expected)
        yield f"{key}={expected}", matches


def _priced_candidates(rows, req):
    by_id = {}
    for row in rows:
        if row["currency"] != "KRW" or row["current_price"] is None:
            continue
        try:
            price = Decimal(str(row["current_price"]))
        except InvalidOperation:
            continue
        if (
            price.is_finite()
            and price > 0
            and all(match for _, match in _criteria(row, req, "required"))
        ):
            score = sum(match for _, match in _criteria(row, req, "preferred"))
            by_id[row["part_id"]] = row, price, score
    return by_id


def _initial(candidates, req):
    locked = req.get("locked_parts", {})
    quantities = req.get("quantities", {})
    if not locked.keys() <= candidates.keys():
        return None
    locked_qty = defaultdict(int)
    base_price = Decimal(0)
    for part_id, qty in locked.items():
        row, price, _ = candidates[part_id]
        locked_qty[row["category"]] += qty
        base_price += price * qty

    remaining = {}
    for category in sorted(set(req["categories"]) | locked_qty.keys() | quantities.keys()):
        fixed = locked_qty.get(category, 0)
        target = quantities.get(category, fixed or 1)
        if target < fixed or (category in _SINGLE and target != 1):
            return None
        if target > fixed:
            remaining[category] = target - fixed
    budget = req["budget_krw"]
    if base_price > budget:
        return None

    # Per category only the cheapest option for each preference score can win.
    # For partial builds with equal score the same dominance rule is exact.
    options = {category: {} for category in remaining}
    for part_id, (row, price, score) in candidates.items():
        category = row["category"]
        if category in options and part_id not in locked:
            cost_and_id = price * remaining[category], part_id
            best = options[category].get(score)
            if best is None or cost_and_id < best:
                options[category][score] = cost_and_id

    plans = {0: (base_price, ())}
    for category in remaining:
        next_plans = {}
        for score, (cost, ids) in plans.items():
            for points, (extra, part_id) in options[category].items():
                plan = (cost + extra, (*ids, part_id))
                combined = score + points
                best = next_plans.get(combined)
                if plan[0] <= budget and (best is None or plan < best):
                    next_plans[combined] = plan
        if not next_plans:
            return None
        plans = next_plans

    selected = dict(locked)
    for qty, part_id in zip(remaining.values(), plans[max(plans)][1], strict=True):
        selected[part_id] = qty
    return selected


def _preview(selection, candidates, req):
    # Physical and power checks use the same calculator as final validation.
    # A preview has no manufacturer evidence. Only the catalog adapter can
    # resolve a CPU support list or QVL match on the transaction snapshot.
    parts = []
    for part_id, qty in selection.items():
        row = candidates[part_id][0]
        parts.append(
            AssemblyPart(
                part_id, row["name"], row["category"], row["specs"], qty, row.get("power_draw_w")
            )
        )
    checks = validate_assembly(
        parts,
        [],
        bios_version=req.get("bios_version"),
        front_radiator_mm=req.get("front_radiator_mm"),
        other_load_w=req.get("other_load_w", DEFAULT_OTHER_LOAD_W),
    )
    return {check.check_type: check.result for check in checks}


def _repair(candidates, req, current, failures, attempted):
    reasons = {
        item["check_type"]: item.get("reason") for item in failures if item["result"] == "FAIL"
    }
    locked = req.get("locked_parts", {})
    visited = {tuple(sorted(selection.items())) for selection in [current, *attempted]}
    total = sum(candidates[key][1] * qty for key, qty in current.items())
    best = None
    chosen = None
    for old_id, qty in sorted(current.items()):
        role = candidates[old_id][0]["category"]
        relevant = sorted(code for code in reasons if role in _REPAIR_ROLES.get(code, ()))
        if old_id in locked or not relevant:
            continue
        priority = min(_REPAIR_ROLES[code].index(role) for code in relevant)
        for new_id, (row, price, preferences) in candidates.items():
            if row["category"] != role or new_id in current:
                continue
            cost = total + qty * (price - candidates[old_id][1])
            if cost > req["budget_krw"]:
                continue
            trial = dict(current)
            del trial[old_id]
            trial[new_id] = qty
            if tuple(sorted(trial.items())) in visited:
                continue
            preview = _preview(trial, candidates, req)
            addressed = [
                code
                for code in relevant
                if preview[code] == "PASS" or (code == "CPU_SUPPORT" and preview[code] == "UNKNOWN")
            ]
            if not addressed:
                continue
            rank = (
                sum(result == "FAIL" for result in preview.values()),
                -len(addressed),
                priority,
                candidates[old_id][2] - preferences,
                cost,
                new_id,
                old_id,
            )
            if best is None or rank < best:
                best = rank
                checks = [
                    f"{code} ({reasons[code]})" if reasons[code] else code for code in addressed
                ]
                chosen = trial, new_id, f"{', '.join(checks)} 실패로 {old_id} → {new_id} 교체"
    return chosen


def choose(
    rows: list[dict],
    req: dict,
    *,
    selection: dict[int, int],
    failures: list[dict],
    attempted: list[dict[int, int]],
) -> tuple[dict[int, int], dict[int, str]] | None:
    """Select by hard constraints, preference count, total cost, then stable IDs."""
    candidates = _priced_candidates(rows, req)
    swap = {}
    if selection:
        replacement = _repair(candidates, req, selection, failures, attempted)
        if replacement is None:
            return None
        selected, new_id, reason = replacement
        swap[new_id] = reason
    else:
        selected = _initial(candidates, req)
        if not selected:
            return None
    basis = {}
    for part_id in selected:
        row = candidates[part_id][0]
        details = ["총예산 이내"]
        if part_id in req.get("locked_parts", {}):
            details.append("사용자가 지정한 고정 부품")
        for priority, label in (("required", "필수"), ("preferred", "선호")):
            details.extend(
                f"{label} {field}" for field, matched in _criteria(row, req, priority) if matched
            )
        if part_id in swap:
            details.append(swap[part_id])
        basis[part_id] = " · ".join(details)
    return selected, basis
