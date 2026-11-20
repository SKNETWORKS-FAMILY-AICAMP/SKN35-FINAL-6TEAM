"""Shop-scoped consultation operations. Prices, identity and evidence come from the server."""

from contextlib import nullcontext

from . import advisor, flow, parts_db
from .catalog import CATEGORY_ORDER, LABELS, validate_selection
from .complete import inspect_build
from .flow import InputError

_CHECK_PARTS = {
    "CPU_SUPPORT": {"cpu", "motherboard"},
    "RAM_TYPE": {"ram", "motherboard"},
    "RAM_SLOTS": {"ram", "motherboard"},
    "RAM_CAPACITY": {"ram", "motherboard"},
    "RAM_FORM_FACTOR": {"ram", "motherboard"},
    "RAM_QVL": {"cpu", "ram", "motherboard"},
    "GPU_CLEARANCE": {"case", "gpu"},
    "BOARD_CASE": {"motherboard", "case"},
    "COOLER_SOCKET": {"cooler", "cpu"},
    "COOLER_CLEARANCE": {"cooler", "case"},
    "COOLER_POWER": {"cooler", "cpu"},
    "STORAGE_INTERFACE": {"storage", "motherboard"},
    "PSU_CASE": {"psu", "case"},
    "PSU_CAPACITY": set(CATEGORY_ORDER),
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


def _market(survey, roles):
    snapshot = _read(floors=flow.floors(survey), include_market=True)
    prices = {part["category"]: part["price"] for part in snapshot.parts}
    if not all(role in prices for role in roles):
        absent = ", ".join(LABELS[role] for role in roles if role not in prices)
        raise InputError(f"현재 DB에 사양과 가격 조건을 충족하는 {absent} 후보가 없습니다.")
    return prices


def plan(survey):
    roles, reasons = flow.steps(survey)
    ids, _ = _ids(survey, {})
    if ids:
        _resolve(_read(part_ids=ids.values()), ids)
    prices = _market(survey, roles)
    return {
        "steps": roles,
        "reasons": reasons,
        "criteria": flow.criteria(survey),
        "allocations": flow.allocations(survey["budget"], roles, prices),
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
    return owned | chosen, {role: key for role, key in chosen.items() if owned.get(role) != key}


def _resolve(snapshot, ids):
    indexed = {row["id"]: row for row in snapshot.parts}
    if any(key not in indexed or indexed[key]["category"] != role for role, key in ids.items()):
        raise InputError("선택한 상품의 업체, 분류 또는 현재 가격을 확인할 수 없습니다.")
    return {role: indexed[key] for role, key in ids.items()}


def _raw_checks(rows, snapshot):
    ids = {role: row["id"] for role, row in rows.items()}
    return validate_selection(ids, rows.values(), snapshot.compatibility)


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
        "CONDITIONAL" if "PENDING" in statuses else "PASS",
    )
    return {"status": status, "checks": checks, "basis": "api"}


def _evaluate(survey, rows, buy, snapshot, *, run_graph):
    raw = _raw_checks(rows, snapshot)
    for role, (spec, minimum) in flow.floors(survey).items():
        if role not in buy:
            continue
        number = rows[role]["specs"].get(spec)
        if not isinstance(number, (int, float)) or number < minimum:
            raw.append(
                {
                    "check_type": "SURVEY_" + role.upper(),
                    "result": "FAIL",
                    "reason": f"{LABELS[role]} 후보의 {spec} 수치가 설문 기준 {minimum} 이상이어야 합니다.",
                }
            )
    if not run_graph and survey["mode"] == "new":
        for check in raw:
            missing = _CHECK_PARTS.get(check["check_type"], set()) - rows.keys()
            if missing and check["result"] == "UNKNOWN":
                check["result"] = "PENDING"
                check["reason"] = (
                    ", ".join(LABELS[r] for r in CATEGORY_ORDER if r in missing)
                    + " 선택 후 검사합니다."
                )
    total = sum(rows[role]["price"] for role in buy)
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
        result.update(inspect_build(survey, list(rows.values()), buy, raw))
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
    return result


def validate(survey, selected):
    ids, buy = _ids(survey, selected)
    snapshot = _read(part_ids=ids.values())
    return _evaluate(survey, _resolve(snapshot, ids), buy, snapshot, run_graph=True)


def candidates(payload, *, validation_stage=nullcontext):
    survey = payload["survey"]
    role = flow.category(payload["category"])
    roles, _ = flow.steps(survey)
    if role not in roles:
        raise InputError("현재 상담 대상에 포함되지 않은 분류입니다.")
    budget = flow.money(payload["budget"], allow_zero=True)
    ids, buy = _ids(survey, payload.get("selected", {}))
    color = (payload.get("color") or "").strip().lower()
    color = {"흰색": "white", "화이트": "white", "검은색": "black", "블랙": "black"}.get(
        color, color
    )
    limits = flow.floors(survey)
    snapshot = _read(
        category=role,
        part_ids=ids.values(),
        budget=budget,
        color=color,
        floors={role: limits[role]} if role in limits else {},
    )
    known = _resolve(snapshot, ids)
    available = min(budget, survey["budget"] - sum(known[k]["price"] for k in buy if k != role))
    previous = flow.owned(survey).get(role)
    passed, review = [], []
    rejected = 0
    with validation_stage():
        for row in sorted(snapshot.parts, key=lambda r: (r["price"], r["id"])):
            if row["category"] != role or row["id"] == previous or row["price"] > available:
                continue
            if color and color not in str(row["specs"].get("color", "")).lower():
                continue
            if role in limits:
                field, minimum = limits[role]
                try:
                    if float(row["specs"].get(field) or 0) < minimum:
                        continue
                except TypeError, ValueError:
                    continue
            rows = {**known, role: row}
            validation = _evaluate(survey, rows, {*buy, role}, snapshot, run_graph=False)
            if validation["status"] == "FAIL":
                rejected += 1
                continue
            result = {
                "part": _public(row),
                "validation": validation,
                "recommended": False,
                "reason": "선택·보유 부품과 확인할 항목이 남아 있습니다.",
            }
            if validation["status"] == "UNKNOWN":
                review.append(result)
            else:
                passed.append(result)
    if passed:
        passed[0].update(
            recommended=True,
            reason="현재 선택에서 탈락하지 않은 후보 중 기준 가격이 가장 낮습니다. 남은 조건도 확인해 주세요.",
        )
    criteria = flow.criteria(survey)
    if note := payload.get("note"):
        criteria.append(f"추가 요청 {note} · 자유 입력 조건은 별도 확인이 필요합니다.")
    return {
        "passed": passed,
        "needsReview": review,
        "rejectedCount": rejected,
        "missingColorCount": snapshot.missing_color_count,
        "sortLabel": f"제조사 근거를 우선 조회한 최대 {parts_db.CANDIDATE_LIMIT}개 후보 · DB 기준 가격 낮은 순",
        "criteria": criteria,
        "basis": "api",
    }


def rebalance(payload, amount):
    requested = flow.money(amount)
    role, survey = flow.category(payload["category"]), payload["survey"]
    roles, _ = flow.steps(survey)
    if role not in roles:
        raise InputError("이 분류에는 예산을 배정할 수 없습니다.")
    ids, buy = _ids(survey, payload.get("selected", {}))
    rows = _resolve(_read(part_ids=ids.values()), ids)
    shares = flow.allocations(survey["budget"], roles, _market(survey, roles), {role: requested})
    total = requested + sum(rows[k]["price"] if k in buy else shares[k] for k in roles if k != role)
    before = total
    alternatives = []
    chosen = dict(payload.get("selected", {}))
    for other in sorted((k for k in buy if k != role), key=lambda k: -rows[k]["price"]):
        if total <= survey["budget"]:
            break
        old = rows[other]
        options = candidates(
            {
                **payload,
                "category": other,
                "budget": old["price"] - 1,
                "color": "",
                "selected": chosen,
            }
        )["passed"]
        if not options:
            continue
        option = options[0]
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
    roles, _ = flow.steps(survey)
    ids, buy = _ids(survey, selected)
    if set(buy) != set(roles):
        raise InputError("구매할 각 분류에서 부품을 선택한 뒤 견적을 만들어 주세요.")
    snapshot = _read(part_ids=ids.values())
    rows = _resolve(snapshot, ids)
    with validation_stage():
        validation = _evaluate(survey, rows, buy, snapshot, run_graph=True)
    if validation["status"] == "FAIL":
        raise InputError("예산 또는 호환성 검사를 통과하지 못했습니다.")
    items = [
        {
            "category": k,
            "source_key": rows[k]["source_key"],
            "part_id": rows[k]["id"],
            "part_name_snapshot": rows[k]["name"],
            "quantity": 1,
            "unit_price": rows[k]["price"],
            "price_checked_at": rows[k]["price_checked_at"],
            "price_status": rows[k]["price_status"],
            "price_basis": rows[k].get("price_basis"),
        }
        for k in CATEGORY_ORDER
        if k in buy
    ]
    return {
        "items": items,
        "validation": validation,
        "total_amount": sum(i["unit_price"] for i in items),
    }


def chat(question, survey, selected, history):
    if not isinstance(question, str) or not question.strip():
        raise InputError("상담 질문을 입력해 주세요.")
    context = {}
    if survey:
        ids, buy = _ids(survey, selected)
        snapshot = _read(part_ids=ids.values())
        rows = _resolve(snapshot, ids)
        checks = _raw_checks(rows, snapshot)
        documents = {s["chunk_key"]: s for c in checks for s in c.get("sources", ())}
        context = {
            "purpose": flow.purpose(survey),
            "budget_krw": survey["budget"],
            "selected": {
                role: {"name": row["name"], "model_number": row["model_number"]}
                for role, row in rows.items()
            },
            "current_purchase": [{"name": rows[k]["name"], "price": rows[k]["price"]} for k in buy],
            "total_krw": sum(rows[k]["price"] for k in buy),
            "checks": [{k: item[k] for k in ("check_type", "reason", "result")} for item in checks],
            "check_documents": list(documents.values()),
        }
    return advisor.advise(question, context, history)
