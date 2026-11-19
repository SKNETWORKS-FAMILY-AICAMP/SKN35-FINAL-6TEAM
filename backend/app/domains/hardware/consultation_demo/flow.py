"""A browser's working quote. Only catalog IDs and explicit choices change its totals."""

from collections import defaultdict
from copy import deepcopy
from dataclasses import dataclass, field
from functools import lru_cache

from .catalog import CATEGORY_ORDER, LABELS, validate_selection

_DISPLAY_SPECS = {
    "capacity_gb",
    "ram_type",
    "wattage_w",
    "length_mm",
    "color",
    "vram_gb",
    "cores",
    "chipset",
}


def _catalog_summary(row):
    return {
        field: row[field]
        for field in (
            "id",
            "category",
            "name",
            "model_number",
            "price",
            "brand",
            "price_status",
            "price_basis",
            "price_checked_at",
            "data_status",
            "currency",
        )
        if field in row
    } | {"specs": {k: v for k, v in row["specs"].items() if k in _DISPLAY_SPECS}}


class InputError(ValueError):
    """A form action cannot be applied to the current quote."""


def _money(value):
    try:
        amount = int(str(value).replace(",", ""))
    except TypeError, ValueError:
        raise InputError("금액을 원 단위 숫자로 입력해 주세요.") from None
    if not 0 < amount <= 1_000_000_000:
        raise InputError("금액은 1원부터 10억원까지 입력할 수 있습니다.")
    return amount


def _text(value, limit, label):
    text = str(value or "").strip()
    if len(text) > limit:
        raise InputError(f"{label}은 {limit}자 이내로 입력해 주세요.")
    return text


@dataclass
class Consultation:
    phase: str = "survey"
    mode: str = "upgrade"
    budget: int = 550_000
    purpose: str = ""
    question: str = ""
    owned: dict = field(default_factory=dict)
    selection: dict = field(default_factory=dict)
    steps: list = field(default_factory=list)
    position: int = 0
    confirmed: list = field(default_factory=list)
    editing: str = ""
    proposal: dict | None = None
    messages: list = field(default_factory=list)
    notice: str = ""
    error: str = ""
    retry_question: str = ""
    retry_introduction: bool = False
    awaiting_gpu_budget: bool = False
    revision: int = 0

    @property
    def category(self):
        if self.phase != "selection":
            return ""
        return self.editing or self.steps[self.position]


class Planner:
    def __init__(
        self, parts, compatibility=(), *, default_build=None, default_owned=None, validator=None
    ):
        self.parts = parts
        self.by_id = {row["id"]: row for row in parts}
        self.by_category = {
            category: sorted(
                (row for row in parts if row["category"] == category),
                key=lambda row: (row["price"], row["id"]),
            )
            for category in CATEGORY_ORDER
        }
        if not all(self.by_category.values()):
            raise ValueError("상담에 필요한 8개 분류의 가격 있는 부품을 모두 조회하지 못했습니다.")
        self.evidence = defaultdict(list)
        for record in compatibility:
            self.evidence[record["part_a_id"], record["part_b_id"]].append(record)
        self.supported_cpus = {
            record["part_b_id"]
            for record in compatibility
            if record["check_type"] == "CPU_SUPPORT" and record["support_status"] != "UNSUPPORTED"
        }
        self._validate = validator or validate_selection
        self._checks = lru_cache(maxsize=512)(self._check_ids)
        self.default_build = default_build
        self._plan = lru_cache(maxsize=32)(self._build_plan)
        self.default_owned = default_owned or self._plan("사무", 1_000_000_000)
        if not self.default_owned:
            raise ValueError("조회된 부품으로 보유 PC 예시를 구성할 수 없습니다.")
        self.suggested_budgets = self._survey_budgets()

    def _survey_budgets(self):
        purpose = "고성능 게임"
        plan = (
            self.default_build
            or self._plan(purpose, 2_000_000)
            or self._plan(purpose, 1_000_000_000)
        )
        base = plan or self.default_owned
        new_total = sum(self.by_id[key]["price"] for key in base.values())
        # Suggest an upgrade budget from an actual non-failing pair. Prefer pairs with
        # more compatibility evidence so the initial budget also offers reviewed models.
        options = {}
        for cat in ("gpu", "ram"):
            existing = self.by_id[self.default_owned[cat]]
            options[cat] = (
                [existing]
                if self.meets_goal(existing, purpose)
                else [row for row in self.by_category[cat] if self.meets_goal(row, purpose)]
            )
        best_upgrade = None
        for gpu in options["gpu"]:
            for ram in options["ram"]:
                replacement = {"gpu": gpu["id"], "ram": ram["id"]}
                cost = sum(
                    self.by_id[key]["price"]
                    for cat, key in replacement.items()
                    if key != self.default_owned[cat]
                )
                checks = self.checks({**self.default_owned, **replacement})
                if not self.blockers(checks):
                    rank = (sum(c["result"] == "UNKNOWN" for c in checks), cost)
                    if best_upgrade is None or rank < best_upgrade:
                        best_upgrade = rank

        # Survey budgets are editable. Round up for small alternatives within the same plan.
        def allowance(cost):
            return max(10_000, ((cost * 11 // 10 + 9_999) // 10_000) * 10_000)

        return {
            "new": allowance(new_total),
            "upgrade": allowance(
                best_upgrade[1]
                if best_upgrade and best_upgrade[1]
                else self.by_id[base["gpu"]]["price"]
            ),
        }

    def lines(self, state, selection):
        return [
            dict(
                category=cat,
                id=key,
                name=self.by_id[key]["name"],
                price=self.by_id[key]["price"],
                quantity=1,
            )
            for cat in CATEGORY_ORDER
            if (key := selection.get(cat)) is not None
            and (state.mode == "new" or state.owned.get(cat) != key)
        ]

    def total(self, state, selection):
        return sum(row["price"] for row in self.lines(state, selection))

    def checks(self, selection):
        return self._checks(tuple(selection.get(cat) for cat in CATEGORY_ORDER))

    def _check_ids(self, keys):
        selection = {cat: key for cat, key in zip(CATEGORY_ORDER, keys, strict=True) if key}
        rows = [self.by_id[key] for key in selection.values()]
        evidence = []
        for category in ("cpu", "ram"):
            pair = selection.get("motherboard"), selection.get(category)
            evidence.extend(self.evidence.get(pair, ()))
        return self._validate(selection, rows, evidence)

    @staticmethod
    def blockers(checks):
        return [c for c in checks if c["result"] == "FAIL"]

    @staticmethod
    def targets(purpose):
        intensive = any(
            tag in purpose for tag in ("게임", "게이밍", "편집", "렌더", "고성능", "3D")
        )
        light = not intensive and any(tag in purpose for tag in ("사무", "문서", "학업"))
        # Sizing preferences used for the initial shortlist, not measured performance.
        return {
            "vram_gb": 2 if light else 12 if "고성능" in purpose else 8,
            "ram": 16 if light else 32,
            "cores": 4 if light else 6,
        }

    def meets_goal(self, row, purpose):
        targets = self.targets(purpose)
        if row["category"] == "ram":
            return (row["specs"].get("capacity_gb") or 0) >= targets["ram"]
        if row["category"] == "gpu":
            return (row["specs"].get("vram_gb") or 0) >= targets["vram_gb"]
        if row["category"] == "cpu":
            return (row["specs"].get("cores") or 0) >= targets["cores"]
        if row["category"] == "storage":
            return (row["specs"].get("capacity_gb") or 0) >= 500
        return True

    def _build_plan(self, purpose, budget):
        """Bound the search over the SQL shortlist and reserve each remaining role's cost."""
        pools = {
            cat: [row for row in rows if self.meets_goal(row, purpose)]
            for cat, rows in self.by_category.items()
        }
        if not all(pools.values()):
            return None
        minimum = sum(rows[0]["price"] for rows in pools.values())
        if minimum > budget:
            return None
        # Pick the platform first so socket support and QVL can guide later choices.
        # Keep a low-cost alternative as well as those backed by more evidence.
        beam = [(0, {})]
        for cat in CATEGORY_ORDER:
            rows = pools[cat]
            minimum -= rows[0]["price"]
            trials = []
            for spent, config in beam:
                for row in rows:
                    cost = spent + row["price"]
                    if cost + minimum > budget:
                        break
                    trial = {**config, cat: row["id"]}
                    checks = self.checks(trial)
                    if self.blockers(checks):
                        continue
                    office_defaults = 0
                    if purpose == "사무":
                        if "ram" in trial:
                            office_defaults += (
                                self.by_id[trial["ram"]]["specs"].get("capacity_gb") != 16
                            )
                        if "gpu" in trial:
                            office_defaults += self.by_id[trial["gpu"]]["specs"]["vram_gb"] >= 8
                        if "psu" in trial:
                            office_defaults += (
                                self.by_id[trial["psu"]]["specs"].get("wattage_w") or 0
                            ) < 650
                    rank = (
                        office_defaults,
                        trial["cpu"] not in self.supported_cpus,
                        sum(c["result"] == "UNKNOWN" for c in checks),
                        sum(c["result"] == "CONDITIONAL" for c in checks),
                        purpose != "사무"
                        and "storage" in trial
                        and self.by_id[trial["storage"]]["specs"]["capacity_gb"] < 1000,
                        cat == "case" and "black" not in str(row["specs"].get("color")).casefold(),
                        cost,
                        tuple(trial.values()),
                    )
                    trials.append((rank, cost, trial))
            if not trials:
                return None
            trials.sort(key=lambda entry: entry[0])
            beam = [(cost, trial) for _, cost, trial in trials[:10]]
            cheapest = min(trials, key=lambda entry: (entry[1], entry[0]))
            if cheapest[2] != beam[0][1]:
                beam.append((cheapest[1], cheapest[2]))
        return beam[0][1]

    def start(self, form):
        mode = form.get("mode", "")
        if mode not in {"upgrade", "new"}:
            raise InputError("부품 교체 또는 신규 조립을 선택해 주세요.")
        purpose = _text(form.get("purpose"), 180, "사용 목적")
        if not purpose:
            raise InputError("사용 목적을 입력해 주세요.")
        state = Consultation(
            mode=mode,
            budget=_money(form.get("budget")),
            purpose=purpose,
            question=_text(form.get("question"), 1500, "상담 내용"),
        )
        if mode == "upgrade":
            for cat in CATEGORY_ORDER:
                value = str(form.get("owned_" + cat, self.default_owned[cat]))
                if not value.isascii() or not value.isdigit() or len(value) > 20:
                    raise InputError("보유 부품을 DB 카탈로그에서 선택해 주세요.")
                key = int(value)
                if key not in self.by_id or self.by_id[key]["category"] != cat:
                    raise InputError(f"{LABELS[cat]}의 보유 모델을 다시 선택해 주세요.")
                state.owned[cat] = key
            state.selection = dict(state.owned)
            state.steps = [
                cat
                for cat in ("gpu", "ram")
                if not self.meets_goal(self.by_id[state.owned[cat]], purpose)
            ]
            if not state.steps:
                state.phase = "consult"
                state.notice = "설문에 적용한 VRAM·RAM 용량 기준을 충족합니다. 게임명과 설정 등 원하는 작업을 상담해 주세요."
                return state
        else:
            state.steps = list(CATEGORY_ORDER)
            plan = self.default_build
            if (
                not plan
                or not self._valid(state, plan)
                or not all(self.meets_goal(self.by_id[key], purpose) for key in plan.values())
            ):
                plan = self._plan(purpose, state.budget)
            if not plan:
                raise InputError(
                    "현재 DB 후보에서 예산과 용도 기준에 맞는 8개 부품 조합을 찾지 못했습니다. "
                    "예산이나 용도를 조정해 주세요."
                )
            state.selection = dict(plan)
        state.phase = "selection"
        return state

    def _valid(self, state, selection):
        return self.total(state, selection) <= state.budget and not self.blockers(
            self.checks(selection)
        )

    def can_finish_ram_upgrade(self, state, config):
        if (
            state.mode != "upgrade"
            or "ram" not in state.steps
            or self.meets_goal(self.by_id[config["ram"]], state.purpose)
        ):
            return True
        return any(
            self.meets_goal(r, state.purpose) and self._valid(state, {**config, "ram": r["id"]})
            for r in self.by_category["ram"]
        )

    def candidates(self, state):
        category = state.category
        if not category:
            return [], []
        eligible, excluded = [], []
        for row in self.by_category[category]:
            key = row["id"]
            if not self.meets_goal(row, state.purpose):
                continue
            if state.mode == "upgrade" and key == state.owned[category]:
                continue
            config = {**state.selection, category: key}
            checks = self.checks(config)
            failed = self.blockers(checks)
            total = self.total(state, config)
            reason = " / ".join(c["reason"] for c in failed)
            if not reason and total > state.budget:
                reason = f"총예산을 {total - state.budget:,}원 초과합니다."
            if not reason and category == "gpu" and not self.can_finish_ram_upgrade(state, config):
                reason = "필요한 RAM까지 교체할 수 있는 예산 내 조합이 없습니다."
            pending = [c for c in checks if c["result"] in {"UNKNOWN", "CONDITIONAL"}]
            if pending:
                preview = " / ".join(c["reason"] for c in pending[:2])
                suffix = f" 외 {len(pending) - 2}건" if len(pending) > 2 else ""
                explanation = f"예산 이내 · 호환 확인 필요. {preview}{suffix}"
            else:
                explanation = "예산 이내이며 현재 구성의 호환 검사를 통과했습니다."
            candidate = dict(
                id=key,
                name=row["name"],
                price=row["price"],
                reason=reason or explanation,
                validated=not reason and not pending,
                recommended=False,
                conditional=bool(pending),
            )
            (excluded if reason else eligible).append(candidate)
        eligible.sort(key=lambda x: (x["price"], x["id"]))
        if eligible:
            if state.mode == "new":
                matches = [r for r in eligible if r["id"] == state.selection.get(category)]
                if matches:
                    matches[0]["recommended"] = True
            else:
                recommendation = next((r for r in eligible if r["validated"]), eligible[0])
                recommendation["recommended"] = True
        return eligible, excluded

    def choose(self, state, value):
        eligible, _ = self.candidates(state)
        chosen = next((r for r in eligible if str(r["id"]) == str(value)), None)
        if chosen is None:
            raise InputError("현재 예산에서 선택 가능한 후보를 다시 확인해 주세요.")
        cat = state.category
        state.selection[cat] = chosen["id"]
        if cat not in state.confirmed:
            state.confirmed.append(cat)
        state.proposal = None
        state.notice = f"{chosen['name']} 선택을 반영했습니다."
        self.advance(state)

    def advance(self, state):
        state.editing = ""
        state.position = next(
            (i for i, cat in enumerate(state.steps) if cat not in state.confirmed), len(state.steps)
        )
        state.phase = "selection" if state.position < len(state.steps) else "quote"

    def proposal_for(self, state, intent, amount):
        if intent == "white_case":
            cat = "case"

            def white(row):
                colors = row["specs"].get("color") or ""
                return "white" in str(colors).casefold() or "화이트" in str(colors)

            if white(self.by_id[state.selection[cat]]):
                return None, "이미 화이트 케이스를 선택했습니다."
            options = [r for r in self.by_category[cat] if white(r)]
        elif intent == "gpu_budget":
            cat = "gpu"
            limit = _money(amount)
            old = self.by_id[state.selection[cat]]["specs"].get("vram_gb")
            if not old:
                return None, "현재 GPU의 VRAM 용량을 확인할 수 없어 상위 용량을 비교할 수 없습니다."
            options = [
                r
                for r in self.by_category[cat]
                if (r["specs"].get("vram_gb") or 0) > old and r["price"] <= limit
            ]
        else:
            return None, ""
        best = None
        checked_costs = []
        for row in options:
            config = {**state.selection, cat: row["id"]}
            variants = [config]
            if cat == "gpu" and state.mode == "new" and self.total(state, config) > state.budget:
                variants.extend(
                    {**config, "storage": s["id"]}
                    for s in self.by_category["storage"]
                    if s["price"] < self.by_id[config["storage"]]["price"]
                    and self.meets_goal(s, state.purpose)
                )
            for candidate in variants:
                if self.blockers(self.checks(candidate)):
                    continue
                total = self.total(state, candidate)
                checked_costs.append(total)
                if total > state.budget or not self.can_finish_ram_upgrade(state, candidate):
                    continue
                score = (
                    -(row["specs"].get("vram_gb") or 0),
                    candidate.get("storage") != state.selection["storage"],
                    total,
                )
                if best is None or score < best[0]:
                    best = score, candidate, total
        if best is None:
            if checked_costs and min(checked_costs) > state.budget:
                return (
                    None,
                    f"비교한 대안의 최저 합계가 총예산을 {min(checked_costs) - state.budget:,}원 초과합니다.",
                )
            return None, "현재 카탈로그에 요청 가격과 호환 조건을 충족하는 변경안이 없습니다."
        _, config, total = best
        changes = []
        for category in CATEGORY_ORDER:
            if config[category] == state.selection[category]:
                continue
            before = self.by_id[state.selection[category]]
            after = self.by_id[config[category]]
            changes.append(
                dict(
                    category=category,
                    old_name=before["name"],
                    new_name=after["name"],
                    delta=after["price"]
                    - (
                        0
                        if state.mode == "upgrade" and before["id"] == state.owned[category]
                        else before["price"]
                    ),
                )
            )
        return dict(
            selection=config,
            total=total,
            changes=changes,
            description=(
                "DB의 VRAM 용량이 더 큰 GPU를 골랐습니다. 게임·작업별 성능 차이는 별도 확인이 필요합니다."
                if cat == "gpu"
                else "DB에 화이트 색상으로 등록된 케이스입니다."
            ),
        ), ""

    def view(self, state):
        candidates, excluded = self.candidates(state)
        lines = self.lines(state, state.selection)
        total = sum(row["price"] for row in lines)
        checks = self.checks(state.selection) if state.selection else []
        return dict(
            phase=state.phase,
            mode=state.mode,
            purpose=state.purpose,
            budget=state.budget,
            owned=self.default_owned if state.phase == "survey" else state.owned,
            selection=state.selection,
            parts=[_catalog_summary(row) for row in self.parts],
            suggested_budgets=self.suggested_budgets,
            category=state.category,
            categories=list(CATEGORY_ORDER),
            steps=state.steps,
            confirmed=state.confirmed,
            candidates=candidates,
            excluded=excluded,
            lines=lines,
            total=total,
            remaining=state.budget - total,
            proposal=state.proposal,
            notice=state.notice,
            checks=checks,
            requires_qvl_consent=any(c["result"] in {"UNKNOWN", "CONDITIONAL"} for c in checks),
            messages=state.messages,
            error=state.error,
            revision=state.revision,
            can_retry=bool(state.retry_question),
        )

    def model_context(self, state):
        candidates, excluded = self.candidates(state)
        checks = self.checks(state.selection)
        documents = {
            source["chunk_key"]: source for check in checks for source in check.get("sources", ())
        }
        return {
            "mode": state.mode,
            "purpose": state.purpose,
            "survey_question": state.question,
            "budget_krw": state.budget,
            "current_category": state.category,
            "awaiting_gpu_budget": state.awaiting_gpu_budget,
            "catalog_status": "DB에 저장된 부품과 기준 가격. 판매량, 실시간 가격, 실측 FPS는 제공되지 않음.",
            "sizing_preferences_not_benchmarks": self.targets(state.purpose),
            "total_krw": self.total(state, state.selection),
            "selected": {
                LABELS[cat]: _catalog_summary(self.by_id[key])
                for cat, key in state.selection.items()
            },
            "owned": (
                {LABELS[cat]: self.by_id[key]["name"] for cat, key in state.owned.items()}
                if state.mode == "upgrade"
                else {}
            ),
            "current_purchase": self.lines(state, state.selection),
            "pending_proposal": (
                {k: state.proposal[k] for k in ("changes", "total", "description")}
                if state.proposal
                else None
            ),
            "change_options_before_validation": [
                _catalog_summary(row)
                for cat in ("gpu", "storage", "case")
                for row in self.by_category[cat][:5]
            ],
            "eligible": [
                _catalog_summary(self.by_id[r["id"]]) | {"reason": r["reason"]}
                for r in candidates[:5]
            ],
            "excluded": [{k: r[k] for k in ("name", "reason")} for r in excluded[:3]],
            "checks": [
                {key: value for key, value in check.items() if key != "sources"}
                | {"evidence_keys": [s["chunk_key"] for s in check.get("sources", ())]}
                for check in checks
            ],
            "check_documents": list(documents.values()),
        }


def _ask(planner, state, question, advisor, *, retry=False, introduction=False):
    from .advisor import AdvisorError

    if not retry:
        state.messages.append({"role": "user", "text": question})
    state.messages = state.messages[-30:]
    state.retry_question = ""
    state.retry_introduction = False
    try:
        result = advisor(question, planner.model_context(state), state.messages[:-1])
    except AdvisorError as exc:
        state.error = str(exc)
        state.retry_question = question
        state.retry_introduction = introduction
        return
    state.messages.append(
        {
            field: result.get(field)
            for field in ("text", "model", "response_id", "sources", "retrieval_mode")
        }
        | {"role": "assistant"}
    )
    intent = result["intent"]
    state.awaiting_gpu_budget = intent == "ask_gpu_budget"
    if state.awaiting_gpu_budget:
        state.notice = "GPU 한 장에 쓸 수 있는 금액을 알려 주세요. 총예산은 그대로 유지됩니다."
    if not introduction and intent in {"gpu_budget", "white_case"}:
        proposal, state.notice = planner.proposal_for(state, intent, result.get("amount"))
        if proposal or not state.proposal:
            state.proposal = proposal
        elif state.notice:
            state.notice += " 이전 변경안은 그대로 남아 있습니다."


def perform(planner, state, form, advisor):
    """Process one same-page form submission, atomically replacing browser state."""
    action = form.get("action", "")
    if action == "reset":
        return Consultation(revision=state.revision)
    if action == "start":
        if state.phase != "survey":
            raise InputError("새 상담은 '다시 시작'을 선택한 뒤 시작해 주세요.")
        draft = planner.start(form)
        draft.revision = state.revision
        initial = draft.question or (
            f"{draft.purpose} 용도로 {draft.budget:,}원 안에서 "
            + (
                "보유 PC를 업그레이드하고 싶어요."
                if draft.mode == "upgrade"
                else "새 PC를 맞추고 싶어요."
            )
        )
        _ask(planner, draft, initial, advisor, introduction=True)
        return draft
    if state.phase in {"survey", "payment"}:
        raise InputError("현재 단계에서 사용할 수 없는 요청입니다.")
    draft = deepcopy(state)
    draft.error = draft.notice = ""

    if action == "choose" and draft.phase == "selection":
        planner.choose(draft, form.get("part_id"))
    elif action == "revise":
        cat = form.get("category")
        if cat not in CATEGORY_ORDER or (draft.phase == "selection" and cat not in draft.confirmed):
            raise InputError("이미 선택한 부품에서 수정할 항목을 골라 주세요.")
        draft.editing, draft.phase, draft.proposal = cat, "selection", None
    elif action == "apply" and draft.proposal:
        config = draft.proposal["selection"]
        if not planner._valid(draft, config):
            raise InputError("가격 또는 검증 조건이 달라졌습니다. 변경안을 다시 요청해 주세요.")
        for cat in CATEGORY_ORDER:
            if config[cat] != draft.selection[cat] and cat not in draft.confirmed:
                draft.confirmed.append(cat)
        draft.selection, draft.proposal = dict(config), None
        planner.advance(draft)
        draft.notice = "선택한 변경안을 적용하고 견적과 호환성을 다시 계산했습니다."
    elif action == "dismiss" and draft.proposal:
        draft.proposal = None
        draft.notice = "이전 부품 선택을 유지합니다."
    elif action == "approve" and draft.phase == "quote":
        if draft.proposal:
            raise InputError("제시된 변경안을 적용하거나 닫은 다음 견적을 승인해 주세요.")
        if not planner.lines(draft, draft.selection) or not planner._valid(draft, draft.selection):
            raise InputError("구매 항목, 예산과 호환성을 다시 확인해 주세요.")
        if (
            any(c["result"] in {"UNKNOWN", "CONDITIONAL"} for c in planner.checks(draft.selection))
            and form.get("accept_qvl") != "1"
        ):
            raise InputError("RAM 등 조건부·미확인 호환 항목을 확인한 후 견적을 승인해 주세요.")
        draft.phase = "payment"
        draft.notice = "최신 견적을 승인했습니다. 시연용 결제 화면입니다."
    elif action in {"chat", "retry"}:
        question = (
            draft.retry_question if action == "retry" else _text(form.get("question"), 1500, "질문")
        )
        if not question:
            raise InputError("상담 질문을 입력해 주세요.")
        _ask(
            planner,
            draft,
            question,
            advisor,
            retry=action == "retry",
            introduction=action == "retry" and draft.retry_introduction,
        )
    elif (
        action == "quote"
        and draft.position == len(draft.steps)
        and planner.lines(draft, draft.selection)
    ):
        draft.phase = "quote"
        draft.editing = ""
    else:
        raise InputError("현재 단계에서 사용할 수 없는 요청입니다.")
    return draft
