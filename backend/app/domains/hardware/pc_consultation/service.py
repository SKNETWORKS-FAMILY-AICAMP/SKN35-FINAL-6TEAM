"""Shop-scoped consultation operations. Prices, identity and evidence come from the server."""

from contextlib import nullcontext
from itertools import batched
from time import monotonic

from app.domains.hardware.reviewed_fit import m2_drive

from . import advisor, cooling, designer, flow, parts_db
from .catalog import CATEGORY_ORDER, LABELS, validate_selection
from .complete import inspect_build
from .flow import InputError

# A slow model call may finish after this interval. Return its verified results
# before starting more calls. Completed decisions stay in the guest session.
_SHORTLIST_WORK_SECONDS = 15
_FIRST_PAGE_SIZE = 10

_CHECK_PARTS = {
    "CPU_SUPPORT": {"cpu", "motherboard"},
    "RAM_TYPE": {"ram", "motherboard"},
    "RAM_SLOTS": {"ram", "motherboard"},
    "RAM_CAPACITY": {"ram", "motherboard"},
    "RAM_FORM_FACTOR": {"ram", "motherboard"},
    "RAM_QVL": {"cpu", "ram", "motherboard"},
    "GPU_CLEARANCE": {"case", "gpu"},
    "GPU_BOARD": {"motherboard", "gpu"},
    "BOARD_CASE": {"motherboard", "case"},
    "COOLER_SOCKET": {"cooler", "cpu"},
    "COOLER_CLEARANCE": {"cooler", "case"},
    "COOLER_POWER": {"cooler", "cpu"},
    "CASE_FANS": {"case", "cooler"},
    "STORAGE_INTERFACE": {"storage", "motherboard"},
    "PSU_CASE": {"psu", "case"},
    "PSU_CAPACITY": {"cpu", "gpu", "psu"},
    "PSU_CLEARANCE": {"psu", "case"},
    "GPU_POWER_CONNECTORS": {"psu", "gpu"},
}


def _read(**options):
    return parts_db.load_catalog(parts_db.SHOP_COMPANY_ID, **options)


def _public(row):
    return {
        k: row[k]
        for k in (
            "source_key",
            "category",
            "brand",
            "name",
            "specs",
            "currency",
            "price_status",
            "price_basis",
            "data_status",
            "price_checked_at",
            "power_draw_w",
            "power_status",
            "image_url",
        )
    } | {"part_id": row["id"], "current_price": row["price"]}


def plan(survey):
    flow.money(survey.get("budget"))
    owned = flow.owned(survey)
    rows = _resolve(_read(part_ids=owned.values()), owned) if owned else {}
    design = designer.design(survey, rows)
    market = _read(include_market=True, survey={**survey, "_design": design})
    prices = {row["category"]: row["price"] for row in market.parts}
    if market.platform_prices is not None:
        if not market.platform_prices:
            raise InputError(
                "현재 카탈로그에서 설계 조건과 제조사 지원 자료를 함께 충족하는 CPU·보드·RAM 조합이 없습니다."
            )
        prices.update(market.platform_prices)
    roles = list(design["reasons"])
    absent = [LABELS[r] for r in roles if r not in prices]
    if absent:
        raise InputError("판매처에서 가격을 확인할 수 없는 분류입니다. " + ", ".join(absent))
    design["minimum_prices"] = {r: prices[r] for r in roles}
    minimum_total = sum(design["minimum_prices"].values())
    if market.platform_prices and minimum_total > survey["budget"]:
        raise InputError(
            f"현재 설계의 호환 조합과 나머지 부품의 최저가 합계는 {minimum_total:,}원입니다. "
            "총예산이나 목표 성능을 조정해 주세요."
        )
    survey["_design"] = design
    return {
        "steps": roles,
        "reasons": design["reasons"],
        "criteria": [],
        "allocations": flow.allocations(
            survey["budget"], roles, design["weights"], minimums=design["minimum_prices"]
        ),
    }


def search_parts(category, query):
    flow.category(category)
    if not isinstance(query, str) or len(query) > 200:
        raise InputError("부품 검색어는 200자 이내로 입력해 주세요.")
    return [_public(row) for row in _read(category=category, query=query.strip(), limit=20).parts]


def _ids(survey, selected):
    roles, _ = flow.steps(survey)
    chosen = flow.part_ids(selected)
    if set(chosen).difference(roles):
        raise InputError("이번 상담에서 선택한 분류의 부품만 사용할 수 있습니다.")
    owned = flow.owned(survey)
    return owned | chosen, {
        role: key
        for role, key in chosen.items()
        if owned.get(role) != key or (role == "cooler" and survey.get("_free_cooler") == key)
    }


def _resolve(snapshot, ids):
    indexed = {row["id"]: row for row in snapshot.parts}
    if any(key not in indexed or indexed[key]["category"] != role for role, key in ids.items()):
        raise InputError("선택한 상품의 업체, 분류 또는 현재 가격을 확인할 수 없습니다.")
    if "cooler" in ids and cooling.is_fan(indexed[ids["cooler"]]):
        raise InputError("케이스 팬은 추가 팬으로 선택해 주세요.")
    return {role: indexed[key] for role, key in ids.items()}


def _raw_checks(rows, snapshot):
    ids = {role: row["id"] for role, row in rows.items()}
    return validate_selection(ids, rows.values(), snapshot.compatibility)


def _blocking(check):
    if check["status"] in ("PASS", "PENDING"):
        return False
    if check["code"] == "GPU_POWER_CONNECTORS" and check["status"] == "CONDITIONAL":
        return False
    # The official graph accepts this documented memory operating condition.
    # Keep the condition visible and require consent at quote approval.
    documented_qvl = (
        check["code"] == "RAM_QVL"
        and check["status"] == "CONDITIONAL"
        and any(s.get("chunk_key", "").startswith("DB-COMPAT-") for s in check.get("sources", []))
    )
    return not documented_qvl


def _result(raw):
    checks = []
    for row in raw:
        sources = row.get("sources", [])
        checks.append(
            {
                "code": row["check_type"],
                "status": row["result"],
                "message": row["reason"],
                "sources": sources,
                "source": ", ".join(s["title"] for s in sources),
            }
        )
    statuses = {check["status"] for check in checks}
    status = next(
        (s for s in ("FAIL", "UNKNOWN", "CONDITIONAL") if s in statuses),
        "PASS",
    )
    return {"status": status, "checks": checks, "basis": "api"}


def _evaluate(survey, rows, buy, snapshot, *, run_graph, scope=None):
    raw = _raw_checks(cooling.check_rows(rows, survey), snapshot)
    if fans := survey.get("_fans"):
        check = cooling.case_fit(rows, fans)
        if run_graph and "case" not in rows and survey["mode"] == "replacement":
            check.update(
                result="UNKNOWN", reason="추가 팬 장착을 확인하려면 보유 케이스가 필요합니다."
            )
        raw.append(check)
    if any(c["check_type"] == "PSU_CAPACITY" and c["result"] == "PASS" for c in raw):
        for check in raw:
            if check["check_type"] == "GPU_POWER_CONNECTORS" and check["result"] == "UNKNOWN":
                # The supply meets the load. An unknown 16-pin cable wattage remains conditional.
                check["result"] = "CONDITIONAL"
    if scope:
        raw = [
            c
            for c in raw
            if c["check_type"] not in _CHECK_PARTS
            or scope in _CHECK_PARTS[c["check_type"]]
            or (c["check_type"] == "PSU_CAPACITY" and "psu" in rows)
            or c["result"] == "FAIL"
        ]
    if run_graph:
        originals = {r["id"]: r for r in snapshot.parts}
        owned = flow.owned(survey)
        for role in buy:
            if floor_reason := designer.below_minimum(survey, rows[role]):
                raw.append(
                    {
                        "check_type": "PERFORMANCE_" + role.upper(),
                        "result": "FAIL",
                        "reason": floor_reason,
                    }
                )
                continue
            accepted, reason, sources = designer.assess(
                {**survey, "mode": "new"}
                if role == "cooler" and survey.get("_free_cooler")
                else survey,
                role,
                [rows[role]],
                originals.get(owned.get(role)),
                selected_cpu=rows.get("cpu"),
            )[0]
            if not accepted:
                code = "PREFERENCE_" if role in survey.get("_preferences", {}) else "PERFORMANCE_"
                raw.append(
                    {
                        "check_type": code + role.upper(),
                        "result": "FAIL",
                        "reason": reason,
                        "sources": sources,
                    }
                )
    if survey["mode"] == "new" and len(rows) < len(CATEGORY_ORDER):
        for check in raw:
            missing = _CHECK_PARTS.get(check["check_type"], set()) - rows.keys()
            if missing and check["result"] == "UNKNOWN":
                check["result"] = "PENDING"
                check["reason"] = (
                    ", ".join(LABELS[r] for r in CATEGORY_ORDER if r in missing)
                    + " 선택 후 검사합니다."
                )
    payable = {k for k in buy if k != "cooler" or rows[k]["id"] != survey.get("_free_cooler")}
    total = sum(rows[role]["price"] for role in payable) + cooling.fan_cost(survey)
    if total > survey["budget"]:
        raw.append(
            {
                "check_type": "BUDGET",
                "result": "FAIL",
                "reason": f"선택한 부품이 총예산을 {total - survey['budget']:,}원 초과합니다.",
            }
        )
    result = _result(raw)
    if run_graph and set(rows) == set(CATEGORY_ORDER):
        result.update(inspect_build(survey, list(rows.values()), payable, raw))
        if result["workflow_status"] != "completed":
            if result["status"] != "FAIL":
                result["status"] = "UNKNOWN"
            result["checks"].append(
                {
                    "code": "QUOTE_WORKFLOW",
                    "status": "UNKNOWN",
                    "message": result["workflow_reason"],
                }
            )
    if (
        run_graph
        and result.get("workflow_status") in (None, "completed")
        and result["status"] != "FAIL"
    ):
        for check in result["checks"]:
            involved = _CHECK_PARTS.get(check["code"], set())
            if involved.intersection(buy) and _blocking(check):
                result.update(workflow_status="needs_revision", workflow_reason=check["message"])
                break
    return result


def validate(survey, selected):
    survey = cooling.resolve(survey, selected, _read)
    ids, buy = _ids(survey, selected)
    snapshot = _read(part_ids=set(ids.values()) | set(flow.owned(survey).values()))
    return _evaluate(survey, _resolve(snapshot, ids), buy, snapshot, run_graph=True)


def _storage_group(row):
    specs = row["specs"]
    protocol, _ = m2_drive(specs) if specs.get("type") == "SSD" else (None, None)
    return {"pcie": 0, "sata": 1}.get(protocol, 2)


def candidates(payload, *, validation_stage=nullcontext, lowest_price=False, explanation=None):
    survey = payload["survey"]
    role = flow.category(payload["category"])
    selected = payload.get("selected", {})
    # Choosing a new cooling configuration starts with a fresh fan basket.
    survey = cooling.resolve(
        {**survey, "_cooling": {}} if role == "cooler" else survey, selected, _read
    )
    roles, _ = flow.steps(survey)
    if role not in roles:
        raise InputError("현재 상담 대상에 포함되지 않은 분류입니다.")
    budget = flow.money(payload["budget"], allow_zero=True)
    ids, buy = _ids(survey, payload.get("selected", {}))
    color = (payload.get("color") or "").strip().lower()
    color = {"흰색": "white", "화이트": "white", "검은색": "black", "블랙": "black"}.get(
        color, color
    )
    previous = flow.owned(survey).get(role)
    snapshot = _read(
        category=role,
        part_ids=set(ids.values()) | ({previous} if previous else set()),
        budget=None if role == "cooler" else budget,
        color=color,
        survey=survey,
        all_candidates=True,
    )
    known = _resolve(snapshot, ids)
    other_cost = sum(
        known[k]["price"] for k in buy if k != role and known[k]["id"] != survey.get("_free_cooler")
    )
    available = min(budget, survey["budget"] - other_cost - cooling.fan_cost(survey))
    original = next((r for r in snapshot.parts if r["id"] == previous), None)
    passed = []
    reasons = {}
    is_new = survey["mode"] == "new"
    sort_sales = is_new and not lowest_price
    prefer_m2 = role == "storage" and not lowest_price
    ordered = sorted(
        snapshot.parts,
        key=lambda r: (
            _storage_group(r) if prefer_m2 else 0,
            -r.get("sold_units", 0) if sort_sales else 0,
            r["price"],
            r["id"],
        ),
    )
    families = None
    if role == "gpu" and (is_new or original):
        families = designer.screen_gpu_families(
            survey,
            [
                r
                for r in ordered
                if r["category"] == role
                and r["id"] != previous
                and r["price"] <= available
                and not designer.below_minimum(survey, r)
            ],
            original,
        )
    rejected = 0

    def reject(row, message):
        reasons[message] = reasons.get(message, 0) + 1
        if explanation is not None and len(explanation["excluded"]) < 128:
            explanation["excluded"].append((row["name"], message))

    if explanation is not None:
        explanation.update(category=role, budget=available, color=color, excluded=[])

    fitting_cases = None
    cooler_specs = known.get("cooler", {}).get("specs", {})
    radiator = cooler_specs.get("radiator_size_mm")
    if role == "psu" and is_new and "case" not in known and (survey.get("_fans") or radiator):
        # Reserve a real installation path before offering a PSU. A power rating on its
        # own cannot establish that the supply fits a case with these fans/radiator.
        fitting_cases = []
        for case in _read(category="case", all_candidates=True).parts:
            specs = case["specs"]
            if radiator and (radiator not in specs.get("front_radiator_sizes_mm", ())
                             and str(radiator) not in specs.get("gpu_clearance_by_front_radiator_mm", {})):
                continue
            if survey.get("_fans") and cooling.case_fit({**known, "case": case}, survey["_fans"])["result"] != "PASS":
                continue
            fitting_cases.append(case)

    def compatible():
        nonlocal rejected
        for row in ordered:
            if cooling.is_fan(row):
                continue
            if row["category"] != role or row["id"] == previous or row["price"] > available:
                continue
            if color and color not in str(row["specs"].get("color", "")).lower():
                continue
            if floor_reason := designer.below_minimum(survey, row):
                reject(row, floor_reason)
                rejected += 1
                continue
            if (
                families is not None
                and (family := designer.gpu_family(row))
                and family not in families
            ):
                reject(row, "설문 목표로 검토한 GPU 칩셋·메모리 범위에 들지 않습니다.")
                rejected += 1
                continue
            rows = {**known, role: row}
            validation = _evaluate(
                survey, rows, {*buy, role}, snapshot, run_graph=False, scope=role
            )
            unresolved = [c for c in validation["checks"] if _blocking(c)]
            if unresolved:
                message = unresolved[0]["message"]
                reject(row, message)
                rejected += 1
                continue
            if fitting_cases is not None:
                for case in fitting_cases:
                    fit = _evaluate(survey, {**rows, "case": case}, {*buy, role, "case"}, snapshot,
                                    run_graph=False, scope="case")
                    if not any(_blocking(c) for c in fit["checks"]):
                        break
                else:
                    reject(row, "선택한 냉각 구성과 파워를 함께 장착할 수 있는 예산 내 케이스가 확인되지 않았습니다.")
                    rejected += 1
                    continue
            yield row, validation

    with validation_stage():
        assessments = survey.setdefault("_assessments", {})
        cached_before = len(assessments)
        started = monotonic()
        for batch in batched(compatible(), _FIRST_PAGE_SIZE, strict=False):
            decisions = designer.assess(
                survey,
                role,
                [r for r, _ in batch],
                original,
                selected_cpu=known.get("cpu"),
            )
            for (row, validation), (accepted, reason, sources) in zip(
                batch, decisions, strict=True
            ):
                if not accepted:
                    reject(row, reason)
                    rejected += 1
                    continue
                validation["checks"].append(
                    {"code": "DESIGN_GOAL", "status": "PASS", "message": reason, "sources": sources}
                )
                passed.append(
                    {
                        "part": _public(row),
                        "validation": validation,
                        "recommended": False,
                        "reason": "",
                    }
                )
                if len(passed) == parts_db.CANDIDATE_LIMIT:
                    break
            if len(passed) == parts_db.CANDIDATE_LIMIT or (
                passed
                and len(assessments) > cached_before
                and monotonic() - started >= _SHORTLIST_WORK_SECONDS
            ):
                break
    sort_label = "호환·성능 향상 확인 후보 중 낮은 가격순"
    if is_new and not lowest_price:
        sort_label = "결제 완료 판매 수량순 · 동률은 낮은 가격순"
    elif is_new:
        sort_label = "호환 후보 중 낮은 가격순"
    if prefer_m2:
        sort_label = "M.2 PCIe SSD 우선 · 같은 방식에서 " + sort_label
    if passed:
        top = passed[0]["part"]["part_id"]
        units = next(r.get("sold_units", 0) for r in ordered if r["id"] == top)
        reason = "기존 부품보다 성능이 향상되는 호환 후보 중 최저가입니다."
        if is_new and lowest_price:
            reason = "다른 부품의 예산을 확보할 수 있는 호환 후보 중 최저가입니다."
        elif is_new:
            reason = (
                f"조건을 충족한 후보 중 판매 수량이 가장 많습니다 ({units}개)."
                if units
                else "후보의 결제 판매 이력이 없어 최저가를 추천합니다."
            )
        if prefer_m2:
            reason = (
                "추천 순서가 가장 높은 저장 방식에서 판매량과 가격으로 고른 후보입니다."
                if is_new
                else "성능이 향상되는 호환 후보 중 우선 저장 방식의 최저가입니다."
            )
        passed[0].update(
            recommended=True,
            reason=reason,
        )
    fan_options = []
    if role == "cooler" and not lowest_price:
        fan_options = [
            _public(r)
            for r in ordered
            if cooling.fan_ready(r)
            and r["price"] <= available
            and ("case" not in known or cooling.case_fit(known, [(r, 1)])["result"] == "PASS")
        ]
        cpu = known.get("cpu")
        # Free options still require a documented thermal and physical fit.
        # An included SKU is referenced by source identity, independent of local DB IDs.
        for row in snapshot.parts:
            if row["category"] != role or cooling.is_fan(row):
                continue
            mode = cooling.free_mode(cpu, row, previous)
            if not mode:
                continue
            free_survey = {**survey, "_free_cooler": row["id"]}
            validation = _evaluate(
                free_survey,
                {**known, role: row},
                {*buy, role},
                snapshot,
                run_graph=False,
                scope=role,
            )
            if not cpu or any(_blocking(c) for c in validation["checks"]):
                continue
            accepted, why, _ = designer.assess(
                {**survey, "mode": "new"}, role, [row], None, selected_cpu=cpu
            )[0]
            if accepted:
                passed = [option for option in passed if option["part"]["part_id"] != row["id"]]
                passed.insert(
                    0,
                    {
                        "part": _public(row) | {"current_price": 0},
                        "cooling_mode": mode,
                        "validation": validation,
                        "recommended": False,
                        "reason": why,
                    },
                )
        if passed:
            index, reason = designer.choose_cooling(survey, known, passed)
            winner = passed.pop(index)
            passed.insert(0, winner)
            for i, option in enumerate(passed):
                option["recommended"] = i == 0
            winner["reason"] = reason
            sort_label = "현재 구성에 맞는 CPU 냉각 방식 우선"
    criteria = []
    if not passed:
        criteria.extend(sorted(reasons, key=reasons.get, reverse=True)[:3])
    if note := payload.get("note"):
        criteria.append(f"추가 요청 {note} · 자유 입력 조건은 별도 확인이 필요합니다.")
    if explanation is not None:
        checks = passed[0]["validation"]["checks"] if passed else []
        evidence = next((c for c in checks if c["code"] == "DESIGN_GOAL"), None)
        if not evidence:
            evidence = next(
                (
                    c
                    for c in checks
                    if c["status"] in {"PASS", "CONDITIONAL"}
                    and role in _CHECK_PARTS.get(c["code"], ())
                    and c["sources"]
                ),
                {},
            )
        explanation.update(
            reasons=sorted(reasons, key=reasons.get, reverse=True)[:2],
            criteria=[survey["_design"]["reasons"][role]],
            shown=[r["part"]["name"] for r in passed],
            reason=passed[0]["reason"] if passed else "",
            evidence=evidence,
        )
    return {
        "passed": passed,
        "fans": fan_options,
        "needsReview": [],
        "rejectedCount": rejected,
        "missingColorCount": snapshot.missing_color_count,
        "sortLabel": sort_label,
        "criteria": criteria,
        "basis": "api",
    }


def rebalance(payload, amount):
    requested = flow.money(amount)
    role = flow.category(payload["category"])
    survey = cooling.resolve(payload["survey"], payload.get("selected", {}), _read)
    roles, _ = flow.steps(survey)
    if role not in roles:
        raise InputError("이 분류에는 예산을 배정할 수 없습니다.")
    ids, buy = _ids(survey, payload.get("selected", {}))
    rows = _resolve(_read(part_ids=ids.values()), ids)
    shares = flow.allocations(
        survey["budget"],
        roles,
        survey["_design"]["weights"],
        {role: requested},
        minimums=survey["_design"]["minimum_prices"],
    )
    total = requested + sum(rows[k]["price"] if k in buy else shares[k] for k in roles if k != role)
    if role != "cooler":
        total += cooling.fan_cost(survey)
        if survey.get("_free_cooler"):
            total -= rows["cooler"]["price"]
    before = total
    alternatives = []
    chosen = dict(payload.get("selected", {}))
    for other in sorted((k for k in buy if k != role), key=lambda k: -rows[k]["price"]):
        if total <= survey["budget"]:
            break
        if other == "cooler" and (survey.get("_fans") or survey.get("_free_cooler")):
            continue
        old = rows[other]
        options = candidates(
            {
                **payload,
                "category": other,
                "budget": old["price"] - 1,
                "color": "",
                "selected": chosen,
            },
            lowest_price=True,
        )["passed"]
        if not options:
            continue
        option = min(options, key=lambda option: option["part"]["current_price"])
        chosen[other] = option["part"]["part_id"]
        total += option["part"]["current_price"] - old["price"]
        alternatives.append(
            {
                "category": other,
                "before": _public(old),
                "after": option["part"],
                "validation": option["validation"],
            }
        )
    return {
        "alternatives": alternatives,
        "beforeTotal": before,
        "afterTotal": total,
        "allocations": shares,
        "feasible": total <= survey["budget"],
        "explanation": "요청 금액, 선택한 부품의 DB 가격과 남은 분류의 배정액을 합산했습니다.",
    }


def quote(survey, selected, *, validation_stage=nullcontext):
    survey = cooling.resolve(survey, selected, _read)
    roles, _ = flow.steps(survey)
    ids, buy = _ids(survey, selected)
    if set(buy) != set(roles):
        raise InputError("구매할 각 분류에서 부품을 선택한 뒤 견적을 만들어 주세요.")
    snapshot = _read(part_ids=set(ids.values()) | set(flow.owned(survey).values()))
    rows = _resolve(snapshot, ids)
    with validation_stage():
        validation = _evaluate(survey, rows, buy, snapshot, run_graph=True)
    if validation["status"] == "FAIL":
        for check in validation["checks"]:
            if check["code"].startswith(("PREFERENCE_", "PERFORMANCE_")):
                raise InputError(check["message"])
        raise InputError("예산 또는 호환성 검사를 통과하지 못했습니다.")
    items = [
        {
            "category": row["category"],
            "source_key": row["source_key"],
            "part_id": row["id"],
            "part_name_snapshot": row["name"],
            "quantity": quantity,
            "unit_price": 0 if row["id"] == survey.get("_free_cooler") else row["price"],
            "price_checked_at": row["price_checked_at"],
            "price_status": row["price_status"],
            "price_basis": row.get("price_basis"),
        }
        for row, quantity in [
            *((rows[k], 1) for k in CATEGORY_ORDER if k in buy),
            *survey.get("_fans", ()),
        ]
    ]
    return {
        "items": items,
        "validation": validation,
        "total_amount": sum(i["unit_price"] * i["quantity"] for i in items),
    }


def chat(question, survey, selected, history):
    if not isinstance(question, str) or not question.strip():
        raise InputError("상담 질문을 입력해 주세요.")
    if designer.enabled():
        preference = designer.generate(
            designer.Preference,
            "고객이 특정 부품의 브랜드나 성능 하한을 변경하라고 명시한 경우만 category와 "
            "requirement를 반환한다. 단순 질문, 예산이나 색상 변경은 category=null로 둔다. "
            "요청이 모호하면 clarification으로 한국어 질문을 한다. 없는 모델을 만들어내지 않는다.",
            {"question": question, "preferences": (survey or {}).get("_preferences", {})},
        )
        if preference.clarification.strip():
            return {"text": preference.clarification, "sources": []}
        if preference.category and preference.requirement.strip():
            return {
                "text": f"{preference.requirement} 조건으로 후보를 다시 확인할게요.",
                "sources": [],
                "_preferences": {preference.category: preference.requirement},
            }
    context = {}
    if survey:
        survey = cooling.resolve(survey, selected, _read)
        ids, buy = _ids(survey, selected)
        snapshot = _read(part_ids=ids.values())
        rows = _resolve(snapshot, ids)
        checks = _raw_checks(cooling.check_rows(rows, survey), snapshot)
        if survey.get("_fans"):
            checks.append(cooling.case_fit(rows, survey["_fans"]))
        documents = {s["chunk_key"]: s for c in checks for s in c.get("sources", ())}
        context = {
            "purpose": flow.purpose(survey),
            "budget_krw": survey["budget"],
            "selected": {
                role: {"name": row["name"], "model_number": row["model_number"]}
                for role, row in rows.items()
            },
            "current_purchase": [
                {"name": rows[k]["name"], "price": rows[k]["price"]}
                for k in buy
                if rows[k]["id"] != survey.get("_free_cooler")
            ],
            "additional_fans": [
                {"name": row["name"], "quantity": n} for row, n in survey.get("_fans", ())
            ],
            "total_krw": sum(
                rows[k]["price"] for k in buy if rows[k]["id"] != survey.get("_free_cooler")
            )
            + cooling.fan_cost(survey),
            "checks": [{k: item[k] for k in ("check_type", "reason", "result")} for item in checks],
            "check_documents": list(documents.values()),
        }
    return advisor.advise(question, context, history)
