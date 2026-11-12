"""하드웨어 채팅 상담의 다음 답 정하기(규칙) — 빠진 조건은 선택지와 함께 되묻고, 다 모이면 처리합니다.

| 의도 | 꼭 필요한 조건(빠지면 이 순서로 하나씩 되물음) | 다 모이면 |
|---|---|---|
| new_recommendation · quote_request | product_types · budget_max · purpose | 요구사항 확정 → 업무팀 실행(추천 · 검증 · 견적) |
| upgrade_diagnosis | owned_device · owned_ram_gb · owned_vram_gb · model_params_b | 보유 장비 진단 결과 |
| cloud_comparison | model_params_b · weekly_hours | 클라우드 대 로컬 비용 비교 |
| compatibility_question · other | — | 안내 + 선택지 |

견적이 이미 있으면 견적 요청에는 '인쇄 · PDF 저장' 안내만 합니다. 실제 LLM 은 부르지 않습니다(Mock 모드).
"""

from app.contracts.schemas import Precision, QuickReplyOut, RequirementsIn, Workload
from app.domains.base import DialogueContext, DialogueReply
from app.domains.hardware.attributes import PRODUCT_TYPE_LABELS
from app.domains.hardware.cloud import cheapest_local_option, compare_cloud, load_cloud_prices
from app.domains.hardware.diagnosis import OwnedDevice, diagnose
from app.domains.hardware.nlu import INTENTS, PURPOSES
from app.domains.hardware.sizing import PRECISION_LABELS, describe, estimate_vram
from app.nlu.base import Slots, SlotValue

REQUIRED: dict[str, tuple[str, ...]] = {
    "new_recommendation": ("product_types", "budget_max", "purpose"),
    "quote_request": ("product_types", "budget_max", "purpose"),
    "upgrade_diagnosis": ("owned_device", "owned_ram_gb", "owned_vram_gb", "model_params_b"),
    "cloud_comparison": ("model_params_b", "weekly_hours"),
}

QUESTIONS: dict[str, str] = {
    "product_types": "어떤 장비를 찾으세요?",
    "budget_max": "예산은 어느 정도인가요? (총액 기준)",
    "purpose": "주로 어디에 쓰실 건가요?",
    "owned_device": "지금 쓰시는 장비는 노트북인가요, 데스크톱인가요?",
    "owned_ram_gb": "지금 장비의 램(메모리)은 몇 GB 인가요?",
    "owned_vram_gb": "그래픽 메모리(VRAM)는 몇 GB 인가요? 내장 그래픽이면 0 입니다.",
    "model_params_b": "돌리려는 모델 크기는요? (예: 7B = 파라미터 70억 개)",
    "weekly_hours": "일주일에 GPU 를 몇 시간쯤 쓰실 예정인가요?",
}

INTENT_CHIPS = [
    QuickReplyOut(label="새 장비 추천받기", slot="intent", value="new_recommendation"),
    QuickReplyOut(label="보유 장비 업그레이드 진단", slot="intent", value="upgrade_diagnosis"),
    QuickReplyOut(label="클라우드 GPU 와 비교", slot="intent", value="cloud_comparison"),
    QuickReplyOut(label="견적 받기", slot="intent", value="quote_request"),
]


def _chip(label: str, slot: str, value: object) -> QuickReplyOut:
    return QuickReplyOut(label=label, slot=slot, value=str(value))


def _chips_for(slot: str, supported: list[str]) -> list[QuickReplyOut]:
    if slot == "product_types":
        return [_chip(PRODUCT_TYPE_LABELS[t], slot, t) for t in supported]
    if slot == "budget_max":
        return [_chip(f"{m}만 원", slot, m * 10_000) for m in (100, 200, 300, 500)]
    if slot == "purpose":
        return [_chip(label, slot, code) for code, label in PURPOSES.items()]
    if slot == "owned_device":
        return [_chip("노트북", slot, "laptop"), _chip("데스크톱", slot, "desktop")]
    if slot == "owned_ram_gb":
        return [_chip(f"{gb}GB", slot, gb) for gb in (8, 16, 32, 64)]
    if slot == "owned_vram_gb":
        chips = [_chip("내장 그래픽(0GB)", slot, 0)]
        return chips + [_chip(f"{gb}GB", slot, gb) for gb in (6, 8, 12, 16, 24)]
    if slot == "model_params_b":
        return [_chip(f"{b}B", slot, b) for b in (1, 7, 13, 30, 70)]
    if slot == "weekly_hours":
        return [_chip(f"주 {h}시간", slot, h) for h in (5, 10, 20, 40)]
    return []


def parse_slot_value(slot: str, value: str) -> SlotValue:
    """선택지로 온 값 검사. 화면이 아닌 곳에서 보낸 값일 수도 있어 엄격하게 봅니다."""
    try:
        if slot == "budget_max":
            number = int(value)
            if not 10_000 <= number <= 1_000_000_000:
                raise ValueError
            return number
        if slot in ("owned_ram_gb", "owned_vram_gb"):
            number = int(value)
            if not 0 <= number <= 4096:
                raise ValueError
            return number
        if slot in ("model_params_b", "weekly_hours"):
            amount = float(value)
            upper = 2000 if slot == "model_params_b" else 168
            if not 0 < amount <= upper:
                raise ValueError
            return int(amount) if amount.is_integer() else amount
        if slot == "purpose" and value in PURPOSES:
            return value
        if slot == "precision":
            return Precision(value).value
        if slot == "owned_device" and value in ("laptop", "desktop"):
            return value
        if slot == "product_types":
            types = [t.strip() for t in value.split(",") if t.strip()]
            if types and all(t in PRODUCT_TYPE_LABELS for t in types):
                return types
    except ValueError:
        pass
    raise ValueError(f"선택지 값이 올바르지 않습니다: {slot}={value}")


def _num(slots: Slots, name: str) -> float:
    value = slots[name]
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise ValueError(f"{name} 는 숫자여야 합니다")
    return float(value)


def _types(slots: Slots) -> list[str]:
    value = slots.get("product_types", [])
    return [str(v) for v in value] if isinstance(value, list) else [str(value)]


def _missing(intent: str, slots: Slots) -> str | None:
    return next((name for name in REQUIRED.get(intent, ()) if name not in slots), None)


def _ask(slot: str, supported: list[str], prefix: str = "") -> DialogueReply:
    return DialogueReply(text=prefix + QUESTIONS[slot], quick_replies=_chips_for(slot, supported))


def _model_target(slots: Slots) -> tuple[float, Precision, Workload] | None:
    if "model_params_b" not in slots:
        return None
    precision = Precision(str(slots.get("precision", Precision.fp16.value)))
    workload = Workload.lora if slots.get("purpose") == "llm_finetune" else Workload.inference
    return _num(slots, "model_params_b"), precision, workload


def _precision_note(slots: Slots) -> tuple[str, list[QuickReplyOut]]:
    if "precision" in slots:
        return "", []
    return (
        " 정밀도를 말씀하지 않아 FP16 기준으로 계산했어요(4비트 양자화면 필요 VRAM 이 1/4 수준).",
        [_chip("4비트로 다시 계산", "precision", Precision.int4.value)],
    )


def _budget_chips(budget: int) -> list[QuickReplyOut]:
    """예산을 100만 원 올리거나 내리는 선택지 — 누르면 요구사항 새 버전이 됩니다."""
    options = [budget + 1_000_000] + ([budget - 1_000_000] if budget > 1_500_000 else [])
    return [
        _chip(f"예산 {amount // 10_000:,}만 원으로", "budget_max", amount) for amount in options
    ]


def _recommend(ctx: DialogueContext, quote: bool) -> DialogueReply:
    slots = dict(ctx.slots)
    wanted = _types(slots)
    supported = [t for t in wanted if t in ctx.supported_product_types]
    if wanted and not supported:
        labels = ", ".join(PRODUCT_TYPE_LABELS.get(t, t) for t in wanted)
        return _ask(
            "product_types",
            ctx.supported_product_types,
            f"이 기업은 {labels} 을(를) 취급하지 않아요. ",
        )
    if supported:
        slots["product_types"] = supported
    missing = _missing("new_recommendation", slots)
    if missing:
        return _ask(missing, ctx.supported_product_types)

    budget = int(_num(slots, "budget_max"))
    purpose = str(slots["purpose"])
    preferences: dict[str, int | float | bool | str] = {}
    summary = [
        ", ".join(PRODUCT_TYPE_LABELS[t] for t in supported),
        f"예산 {budget:,}원",
        PURPOSES[purpose],
    ]
    chips: list[QuickReplyOut] = []
    target = _model_target(slots)
    if target is not None:
        params, precision, workload = target
        estimate = estimate_vram(params, precision, workload)
        preferences = {
            "model_params_b": params,
            "precision": precision.value,
            "workload": workload.value,
        }
        summary.append(f"{describe(estimate)} → 필요 VRAM 약 {estimate.required_vram_gb:g}GB")
    note, precision_chips = _precision_note(slots) if target is not None else ("", [])
    chips += precision_chips
    chips += _budget_chips(budget)
    skipped = [t for t in wanted if t not in supported]
    skipped_note = (
        f" ({', '.join(PRODUCT_TYPE_LABELS.get(t, t) for t in skipped)} 은(는) 이 기업이 취급하지 않아 뺐어요.)"
        if skipped
        else ""
    )
    goal = "견적까지 만들게요" if quote else "후보를 찾고 검증 · 견적까지 진행합니다"
    text = (
        f"조건을 정리했어요 — {' · '.join(summary)}.{skipped_note}{note}"
        f" 업무팀이 {goal}(오른쪽 AI 오피스에서 진행 상황이 보여요)."
    )
    requirements = RequirementsIn(
        purpose=PURPOSES[purpose],
        product_types=supported,
        budget_max=budget,
        preferences=preferences,
        note="채팅 상담으로 정리한 조건",
    )
    return DialogueReply(text=text, quick_replies=chips, requirements=requirements)


def _diagnose(ctx: DialogueContext) -> DialogueReply:
    slots = ctx.slots
    missing = _missing("upgrade_diagnosis", slots)
    if missing:
        return _ask(missing, ctx.supported_product_types)
    target = _model_target(slots)
    assert target is not None
    estimate = estimate_vram(*target)
    device = OwnedDevice(
        device_type="laptop" if slots["owned_device"] == "laptop" else "desktop",
        ram_gb=int(_num(slots, "owned_ram_gb")),
        gpu_vram_gb=int(_num(slots, "owned_vram_gb")),
    )
    result = diagnose(device, estimate)
    lines = [
        f"{result.verdict_label} — {describe(estimate)} 기준 필요 VRAM 약 {estimate.required_vram_gb:g}GB."
    ]
    lines += [
        f"· {item.detail} (보유 {item.have} / 필요 {item.need})"
        for item in result.items
        if not (item.component == "storage" and item.status == "unknown")  # 채팅에서는 묻지 않음
    ]
    if result.verdict == "needs_check":
        lines.append(
            "램 온보드 여부 · 빈 슬롯은 장비 사양표에서 확인해 주세요(도구 API 로 자세히 진단할 수 있어요)."
        )
    note, chips = _precision_note(slots)
    if note:
        lines.append(note.strip())
    chips += [
        _chip("새 장비 추천받기", "intent", "new_recommendation"),
        _chip("클라우드 GPU 와 비교", "intent", "cloud_comparison"),
    ]
    return DialogueReply(text="\n".join(lines), quick_replies=chips)


def _cloud(ctx: DialogueContext) -> DialogueReply:
    slots = ctx.slots
    missing = _missing("cloud_comparison", slots)
    if missing:
        return _ask(missing, ctx.supported_product_types)
    target = _model_target(slots)
    assert target is not None
    estimate = estimate_vram(*target)
    local = cheapest_local_option(ctx.catalog(), estimate.required_vram_gb)
    hours = _num(slots, "weekly_hours")
    result = compare_cloud(estimate, hours, load_cloud_prices(ctx.fixtures_dir), local)
    note, chips = _precision_note(slots)
    other_hours = [h for h in (5, 10, 20, 40) if h != hours][:2]
    chips = chips + [_chip(f"주 {h}시간이면?", "weekly_hours", h) for h in other_hours]
    chips.append(_chip("새 장비 추천받기", "intent", "new_recommendation"))
    text = result.summary + note + " (가상 공급자 · 가상 가격 — 테스트 데이터)"
    return DialogueReply(text=text, quick_replies=chips)


def respond(ctx: DialogueContext) -> DialogueReply:
    intent = ctx.intent if ctx.intent in INTENTS else "other"
    if intent == "new_recommendation":
        return _recommend(ctx, quote=False)
    if intent == "quote_request":
        if ctx.has_quotation:
            return DialogueReply(
                text="지금 조건의 참고 견적이 오른쪽 '참고 견적' 표에 있어요. '인쇄 · PDF 저장' 버튼으로 받을 수 있습니다"
                " (참고 견적 · 테스트 데이터 — 실제 판매가 아님).",
                quick_replies=_budget_chips(int(_num(ctx.slots, "budget_max")))
                if "budget_max" in ctx.slots
                else [],
            )
        return _recommend(ctx, quote=True)
    if intent == "upgrade_diagnosis":
        return _diagnose(ctx)
    if intent == "cloud_comparison":
        return _cloud(ctx)
    if intent == "compatibility_question":
        return DialogueReply(
            text="호환성은 검증팀이 후보마다 확인해요(그래픽카드 길이 · 권장 파워 · 랙 높이)."
            " 어떤 장비를 찾는지부터 알려 주시면 후보를 고를 때 함께 봅니다.",
            quick_replies=INTENT_CHIPS[:2],
        )
    precision_labels = " · ".join(PRECISION_LABELS.values())
    return DialogueReply(
        text="AI 상담 직원입니다(Mock 모드 · 테스트 데이터). 새 장비 추천, 가진 장비 업그레이드 진단,"
        f" 클라우드 GPU 비교, 견적을 도와드려요. 모델 크기(예: 7B)와 정밀도({precision_labels})를"
        " 알려 주시면 필요한 그래픽 메모리도 계산해 드립니다.",
        quick_replies=list(INTENT_CHIPS),
    )
