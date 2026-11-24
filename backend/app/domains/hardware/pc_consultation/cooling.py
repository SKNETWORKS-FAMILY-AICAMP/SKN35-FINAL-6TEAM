"""Cooling choices resolved from the shop's own parts and reviewed installation data."""

from decimal import Decimal

from .flow import InputError, owned


def is_fan(row):
    return row["specs"].get("cooling_type") == "case_fan"


def fan_ready(row):
    specs = row["specs"]
    return (
        is_fan(row)
        and specs.get("fans_per_item") == 1
        and all(
            type(specs.get(k)) in (int, float) and specs[k] > 0
            for k in ("fan_size_mm", "thickness_mm", "fan_w")
        )
    )


def free_mode(cpu, cooler, owned_id):
    if cooler["id"] == owned_id:
        return "reuse"
    if cpu and cpu["specs"].get("included_cooler_source_key") == cooler["source_key"]:
        return "bundled"
    return None


def resolve(survey, selected, read):
    config = survey.get("_cooling") or {}
    mode = config.get("mode", "purchase")
    lines = config.get("fans", [])
    if not lines and mode == "purchase":
        return survey
    if "cooler" not in selected:
        raise InputError("CPU 냉각 방식을 먼저 선택해 주세요.")
    ids = owned(survey) | selected
    required = {line["part_id"] for line in lines} | {ids["cooler"]}
    if "cpu" in ids:
        required.add(ids["cpu"])
    rows = {r["id"]: r for r in read(part_ids=required).parts}
    cooler = rows.get(ids["cooler"])
    if not cooler or cooler["category"] != "cooler" or is_fan(cooler):
        raise InputError("CPU 쿨러를 선택해 주세요.")
    if mode != "purchase" and mode != free_mode(
        rows.get(ids.get("cpu")), cooler, owned(survey).get("cooler")
    ):
        raise InputError("동봉 또는 보유 사실을 확인할 수 없는 쿨러입니다.")
    fans = []
    for line in lines:
        fan = rows.get(line["part_id"])
        if not fan or not fan_ready(fan):
            raise InputError("판매처에서 규격과 가격이 확인된 케이스 팬을 선택해 주세요.")
        fans.append((fan, line["quantity"]))
    return {**survey, "_fans": fans, "_free_cooler": cooler["id"] if mode != "purchase" else None}


def fan_cost(survey):
    return sum(row["price"] * qty for row, qty in survey.get("_fans", ()))


def check_rows(rows, survey):
    fans = survey.get("_fans", ())
    if not fans or "cooler" not in rows:
        return rows
    cooler = rows["cooler"]
    watts = cooler.get("power_draw_w")
    if watts is not None:
        watts = Decimal(str(watts)) + sum(
            Decimal(str(fan["specs"]["fan_w"])) * qty for fan, qty in fans
        )
    return {**rows, "cooler": {**cooler, "power_draw_w": watts}}


def case_fit(rows, fans):
    if "case" not in rows:
        return {
            "check_type": "CASE_FANS",
            "result": "PENDING",
            "reason": "케이스 선택 후 팬 장착 위치를 확인합니다.",
        }
    case = rows["case"]["specs"]
    bays = case.get("free_fan_bays")
    if not bays:
        return {
            "check_type": "CASE_FANS",
            "result": "UNKNOWN",
            "reason": "기본 팬을 제외한 장착 위치가 확인되지 않았습니다.",
        }
    radiator = rows.get("cooler", {}).get("specs", {}).get("radiator_size_mm")
    # The assembly validator currently fits AIOs at the front. Each entry is
    # one independent free mount after factory fans have been accounted for.
    slots = [
        bay
        for bay in bays
        if not (radiator and bay["position"] == "front")
        for _ in range(bay["count"])
    ]
    drives = [fan["specs"] for fan, qty in fans for _ in range(qty)]
    # These mounts have one verified diameter. Assign thicker fans first.
    for fan in sorted(drives, key=lambda f: -f["thickness_mm"]):
        match = next(
            (
                bay
                for bay in slots
                if bay["diameter_mm"] == fan["fan_size_mm"]
                and bay["thickness_mm"] >= fan["thickness_mm"]
            ),
            None,
        )
        if match is None:
            return {
                "check_type": "CASE_FANS",
                "result": "FAIL",
                "reason": "선택한 추가 팬을 모두 장착할 빈 위치가 부족합니다.",
            }
        slots.remove(match)
    return {
        "check_type": "CASE_FANS",
        "result": "PASS",
        "reason": f"추가 팬 {len(drives)}개의 장착 위치를 확인했습니다.",
    }
