"""NLU 평가 지표 — 의도 정확도 · macro-F1, 슬롯 F1(micro).

슬롯은 (슬롯 이름, 값) 쌍으로 셉니다. 리스트 슬롯(예: product_types)은 값 하나마다 한 쌍,
숫자는 7 과 7.0 을 같은 값으로 봅니다. 예측 쌍이 정답 쌍과 정확히 같아야 맞은 것입니다.
"""

from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass, field

from app.nlu.base import Slots, SlotValue


@dataclass(frozen=True)
class Prf:
    precision: float
    recall: float
    f1: float
    support: int


def _prf(tp: int, fp: int, fn: int) -> Prf:
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return Prf(round(precision, 4), round(recall, 4), round(f1, 4), tp + fn)


@dataclass(frozen=True)
class IntentReport:
    accuracy: float
    macro_f1: float
    per_intent: dict[str, Prf]
    confusion: dict[tuple[str, str], int] = field(default_factory=dict)  # (정답, 예측) → 건수


def intent_report(gold: Sequence[str], pred: Sequence[str], labels: Sequence[str]) -> IntentReport:
    if len(gold) != len(pred) or not gold:
        raise ValueError("정답과 예측의 개수가 같아야 하고 1개 이상이어야 합니다")
    per: dict[str, Prf] = {}
    for label in labels:
        tp = sum(1 for g, p in zip(gold, pred, strict=True) if g == label and p == label)
        fp = sum(1 for g, p in zip(gold, pred, strict=True) if g != label and p == label)
        fn = sum(1 for g, p in zip(gold, pred, strict=True) if g == label and p != label)
        per[label] = _prf(tp, fp, fn)
    accuracy = sum(1 for g, p in zip(gold, pred, strict=True) if g == p) / len(gold)
    macro = sum(r.f1 for r in per.values()) / len(per)
    confusion = Counter(zip(gold, pred, strict=True))
    return IntentReport(round(accuracy, 4), round(macro, 4), per, dict(confusion))


def _canonical(value: SlotValue) -> str:
    if isinstance(value, bool):
        return str(value).lower()
    if isinstance(value, int | float):
        return f"{round(float(value), 3):g}"
    return str(value).strip().lower()


def slot_pairs(slots: Slots) -> set[tuple[str, str]]:
    pairs: set[tuple[str, str]] = set()
    for name, value in slots.items():
        values = value if isinstance(value, list) else [value]
        pairs.update((name, _canonical(v)) for v in values)
    return pairs


@dataclass(frozen=True)
class SlotReport:
    micro: Prf
    per_slot: dict[str, Prf]
    exact_match: float  # 발화의 슬롯 전체가 정답과 똑같은 비율


def slot_report(gold: Sequence[Slots], pred: Sequence[Slots]) -> SlotReport:
    if len(gold) != len(pred) or not gold:
        raise ValueError("정답과 예측의 개수가 같아야 하고 1개 이상이어야 합니다")
    tp = fp = fn = 0
    per_counts: dict[str, list[int]] = {}
    exact = 0
    for g_slots, p_slots in zip(gold, pred, strict=True):
        g, p = slot_pairs(g_slots), slot_pairs(p_slots)
        exact += g == p
        tp += len(g & p)
        fp += len(p - g)
        fn += len(g - p)
        for name, _ in g | p:
            per_counts.setdefault(name, [0, 0, 0])
        for name, _ in g & p:
            per_counts[name][0] += 1
        for name, _ in p - g:
            per_counts[name][1] += 1
        for name, _ in g - p:
            per_counts[name][2] += 1
    per_slot = {name: _prf(*counts) for name, counts in sorted(per_counts.items())}
    return SlotReport(_prf(tp, fp, fn), per_slot, round(exact / len(gold), 4))
