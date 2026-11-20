"""Consultation, evidence retrieval, component selection, validation and draft pricing."""

import re
from decimal import Decimal

from pydantic import ValidationError

from app.domains.hardware.ingestion.docyx import BRANDS
from app.domains.hardware.quote_graph.adapters import ServiceUnavailable
from app.domains.hardware.quote_graph.design import choose
from app.domains.hardware.quote_graph.state import QuoteState, Requirements

_ALIASES = {
    "CPU": "cpu",
    "메인보드": "motherboard",
    "마더보드": "motherboard",
    "램": "ram",
    "RAM": "ram",
    "메모리": "ram",
    "그래픽카드": "gpu",
    "GPU": "gpu",
    "SSD": "storage",
    "저장장치": "storage",
    "파워": "psu",
    "PSU": "psu",
    "케이스": "case",
    "쿨러": "cooler",
}
_BRANDS = {name.casefold(): name for name in BRANDS} | {
    "삼성": "Samsung",
    "인텔": "Intel",
    "에이수스": "ASUS",
}
_BRAND = "|".join(re.escape(word) for word in sorted(_BRANDS, key=len, reverse=True))
_CATEGORY = "|".join(_ALIASES)
_BRAND_REQUEST = re.compile(
    rf"(?<![a-z0-9])({_BRAND})\s*({_CATEGORY})(?:을|를|는|은|가|이)?\s*"
    r"(필수|고정|선호|우선|제외)",
    re.IGNORECASE,
)
_MONEY = r"(?<![-\d,.])((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*(만|천)?\s*원"
_BUDGET = re.compile(r"(?:예산|상한)(?:은|는)?\s*[:=]?\s*" + _MONEY)
_RAG_BRAND = re.compile(rf"(?<![a-z0-9])({_BRAND})\s*공식\s*(?:자료|문서|가이드)", re.I)
_RAG_CATEGORY = re.compile(
    r"(메인보드·저장장치|모니터·도크|케이스·냉각|메모리 업그레이드|서버 메모리)\s*(?:자료|문서|가이드)"
)
_PURPOSE = re.compile(
    r"게임|게이밍|사무|문서\s*작업|영상\s*편집|렌더링|개발|머신러닝|딥러닝|로컬\s*LLM", re.I
)
ASSEMBLY_CHECK_TYPES = {
    "CPU_SUPPORT",
    "RAM_TYPE",
    "RAM_FORM_FACTOR",
    "RAM_SLOTS",
    "RAM_CAPACITY",
    "RAM_QVL",
    "GPU_CLEARANCE",
    "PSU_CAPACITY",
}


def _requirements(raw: dict) -> Requirements:
    if not isinstance(raw, dict):
        raise ValueError("요청은 JSON 객체여야 합니다.")
    data = dict(raw)
    question = data.get("question", "")
    if not isinstance(question, str):
        raise ValueError("질문을 문자열로 입력하세요.")
    if "purpose" not in data and (purpose := _PURPOSE.search(question)):
        data["purpose"] = purpose[0]
    # A price next to a particular part is not necessarily the whole-build budget.
    budget_mentions = _BUDGET.findall(question)
    if not budget_mentions:
        budget_mentions = re.findall(_MONEY + r"\s*(?:예산|이내|이하|한도)", question)
    if not budget_mentions and (leading := re.match(r"^\s*" + _MONEY, question)):
        budget_mentions = [leading.groups()]
    amounts = {
        Decimal(amount.replace(",", "")) * {"": 1, "천": 1000, "만": 10000}[unit]
        for amount, unit in budget_mentions
    }
    if budget_mentions and len(amounts) > 1:
        raise ValueError("여러 예산 상한이 있습니다. 전체 조립 예산을 하나로 지정해 주세요.")
    if "budget_krw" not in data and len(amounts) == 1:
        data["budget_krw"] = next(iter(amounts))

    req = Requirements.model_validate(data)
    if budget_mentions and req.budget_krw not in amounts:
        raise ValueError("질문에 적힌 예산과 budget_krw가 다릅니다. 총예산을 확인하세요.")
    categories = {word.casefold(): value for word, value in _ALIASES.items()}
    for brand, label, modifier in _BRAND_REQUEST.findall(question):
        if modifier == "제외":
            raise ValueError("제외할 브랜드 조건을 반영하려면 허용할 브랜드를 지정해 주세요.")
        mapping = req.preferred_brands if modifier in {"선호", "우선"} else req.required_brands
        category, value = categories[label.casefold()], _BRANDS[brand.casefold()]
        if mapping.setdefault(category, value).casefold() != value.casefold():
            raise ValueError(f"{category} 브랜드 조건이 서로 다릅니다.")

    for standard, modifier in re.findall(
        r"(DDR[2-5])\s*(?:램|메모리)?\s*(필수|선호|우선|제외)", question, re.I
    ):
        if modifier == "제외":
            raise ValueError("필요한 RAM 규격을 required_specs로 지정해 주세요.")
        specs = req.preferred_specs if modifier in {"선호", "우선"} else req.required_specs
        if (
            str(specs.setdefault("ram", {}).setdefault("ram_type", standard.upper())).upper()
            != standard.upper()
        ):
            raise ValueError("RAM 규격 조건이 서로 다릅니다.")

    scoped = (
        set(req.required_brands)
        | set(req.preferred_brands)
        | set(req.required_specs)
        | set(req.preferred_specs)
        | set(req.quantities)
    )
    if missing := sorted(scoped - set(req.categories)):
        raise ValueError(
            f"조건을 지정한 부품 분류를 categories에 포함해 주세요: {', '.join(missing)}"
        )
    req.categories = list(dict.fromkeys(req.categories))
    req.rag_filters.setdefault("verification_status", "verified")
    # Filter on explicit document requests. A preferred product brand alone is
    # not a request to exclude other publishers from retrieval.
    for field, values in (
        ("brand", {_BRANDS[name.casefold()] for name in _RAG_BRAND.findall(question)}),
        ("category", set(_RAG_CATEGORY.findall(question))),
    ):
        if len(values) == 1:
            req.rag_filters.setdefault(field, next(iter(values)))
    if re.search("QVL", question, re.I) and re.search("RAM|메모리|램", question, re.I):
        req.rag_filters.setdefault("topic", "memory_qvl")
    return req


def consultation(state: QuoteState) -> dict:
    initial = {
        "retry_count": 0,
        "selection": {},
        "selection_basis": {},
        "attempted_selections": [],
        "checks": [],
        "blocking_failures": [],
        "conditions": [],
        "rag_hits": [],
        "citations": [],
        "quote_draft": None,
        "reason": "",
    }
    try:
        req = _requirements(state.get("request"))
    except ValidationError as exc:
        fields = ", ".join(".".join(map(str, error["loc"])) for error in exc.errors())
        return {**initial, "status": "needs_input", "reason": f"요청 값을 확인해 주세요: {fields}"}
    except ValueError as exc:
        return {**initial, "status": "needs_input", "reason": str(exc)}
    return {
        **initial,
        "requirements": req.model_dump(),
        "rag_filters": req.rag_filters,
        "max_retries": req.max_retries,
        "status": "running",
    }


def retrieve_rag(state: QuoteState, services) -> dict:
    try:
        hits = services.retrieve(state["requirements"]["question"], state["rag_filters"])
    except ServiceUnavailable as exc:
        return {"status": "needs_revision", "reason": f"RAG 검색 오류: {exc}"}
    citations = [
        {
            key: hit[key]
            for key in ("chunk_key", "source_key", "source_url", "source_title", "publisher")
        }
        for hit in hits
        if hit.get("verification_status") == "verified" and hit.get("source_url")
    ]
    if not citations:
        return {
            "status": "needs_revision",
            "reason": "해당 조건에서 검증된 출처를 찾지 못했습니다.",
            "rag_hits": hits,
        }
    return {"rag_hits": hits, "citations": citations}


def design(state: QuoteState, services) -> dict:
    req = state["requirements"]
    proposal = state.get("replacement")
    update = {}
    if proposal is None:
        try:
            rows = services.catalog(req["categories"], locked_ids=req["locked_parts"])
        except ServiceUnavailable as exc:
            return {"status": "needs_revision", "reason": f"카탈로그 조회 오류: {exc}"}
        proposal = choose(rows, req, selection={}, failures=[], attempted=[])
        if proposal is None:
            return {
                "status": "needs_revision",
                "reason": "필수조건과 총예산을 충족하며 가격을 확인할 수 있는 조합이 없습니다.",
            }
        update["candidates"] = rows
    else:
        update["retry_count"] = state["retry_count"] + 1
    selection, basis = proposal
    previous = state["selection_basis"]
    return {
        **update,
        "selection": selection,
        "selection_basis": {key: previous.get(key, basis[key]) for key in selection},
        "attempted_selections": [*state["attempted_selections"], selection],
        "replacement": None,
    }


def validation(state: QuoteState, services) -> dict:
    req = state["requirements"]
    try:
        checks = services.validate(
            state["selection"],
            bios_version=req["bios_version"],
            front_radiator_mm=req["front_radiator_mm"],
            other_load_w=req["other_load_w"],
        )
    except ServiceUnavailable as exc:
        return {
            "status": "needs_revision",
            "reason": f"조립 검증 오류: {exc}",
            "checks": [],
            "conditions": [],
            "blocking_failures": [],
        }
    update = {"checks": checks, "conditions": [], "blocking_failures": []}
    if (
        len(checks) != len(ASSEMBLY_CHECK_TYPES)
        or {c["check_type"] for c in checks} != ASSEMBLY_CHECK_TYPES
    ):
        return {**update, "status": "needs_revision", "reason": "조립 검증 결과가 불완전합니다."}
    blockers = []
    prompt_qvl = False
    for check in checks:
        if check["result"] == "PASS":
            continue
        if (
            check["check_type"] == "RAM_QVL"
            and check["result"] == "CONDITIONAL"
            and check["compatibility_ids"]
            and check["source_urls"]
        ):
            if req["allow_conditional_qvl"]:
                update["conditions"].append(check)
                continue
            prompt_qvl = True
        blockers.append(check)
    update["blocking_failures"] = blockers
    failures = [check for check in blockers if check["result"] == "FAIL"]
    if failures:
        if state["retry_count"] >= state["max_retries"]:
            return {
                **update,
                "status": "needs_revision",
                "reason": "재설계 횟수 한도에 도달했습니다.",
            }
        proposal = choose(
            state["candidates"],
            req,
            selection=state["selection"],
            failures=failures,
            attempted=state["attempted_selections"],
        )
        if proposal is None:
            return {
                **update,
                "status": "needs_revision",
                "reason": "실패 항목을 교체할 수 있는 예산 내 미시도 후보가 없습니다.",
            }
        return {**update, "replacement": proposal}
    if blockers:
        reason = " / ".join(f"{c['check_type']}: {c['reason']}" for c in blockers)
        if any(check["check_type"] == "RAM_QVL" for check in blockers) and not prompt_qvl:
            return {
                **update,
                "status": "needs_revision",
                "reason": reason + " 해당 키트의 제조사 QVL 출처를 확인해야 합니다.",
            }
        if prompt_qvl:
            reason += " 조건부 QVL 초안을 원하면 allow_conditional_qvl을 true로 지정하세요."
        return {**update, "status": "needs_input", "reason": reason}
    return update


def quotation(state: QuoteState) -> dict:
    items = []
    for row in state["candidates"]:
        part_id = row["part_id"]
        if part_id not in state["selection"]:
            continue
        quantity = state["selection"][part_id]
        price = Decimal(str(row["current_price"]))
        provenance = row["specs"].get("_provenance", {})
        source_key = provenance.get("source_key")
        chunk_keys = [
            hit["chunk_key"]
            for hit in state["rag_hits"]
            if source_key
            and hit.get("verification_status") == "verified"
            and any(
                link["part_id"] == part_id and link["part_source_key"] == source_key
                for link in hit.get("links", {}).get("parts", [])
            )
        ]
        items.append(
            {
                "part_id": part_id,
                "category": row["category"],
                "name": row["name"],
                "quantity": quantity,
                "unit_price": price,
                "line_total": price * quantity,
                "price_checked_at": row["price_checked_at"],
                "price_status": provenance.get("price_status", "unconfirmed"),
                "price_basis": provenance.get("price_basis"),
                "selection_basis": state["selection_basis"][part_id],
                "chunk_keys": chunk_keys,
            }
        )
    items.sort(key=lambda item: item["part_id"])
    draft = {
        "purpose": state["requirements"]["purpose"],
        "currency": "KRW",
        "items": items,
        "total_amount": sum((item["line_total"] for item in items), Decimal(0)),
        "checks": state["checks"],
        "conditions": state["conditions"],
        "citations": state["citations"],
    }
    return {"status": "completed", "quote_draft": draft}
