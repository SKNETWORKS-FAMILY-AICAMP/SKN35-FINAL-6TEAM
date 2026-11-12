"""NLU 평가 스크립트 — 라벨 붙은 발화로 의도 정확도 · macro-F1, 슬롯 F1 을 냅니다.

    uv run python -m app.nlu.evaluate                       # 기본: hardware 팩 · data/nlu/hardware_eval_v1.jsonl
    uv run python -m app.nlu.evaluate --errors              # 틀린 발화도 보기
    uv run python -m app.nlu.evaluate --json result.json    # 결과를 파일로(결과서 표에 옮길 때)

DB 가 필요 없습니다. 3주차 학습 모델도 같은 IntentClassifier · SlotExtractor 를 구현하면
이 스크립트로 같은 평가셋 · 같은 지표를 냅니다(docs/ML_PLAN.md).
"""

import argparse
import json
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from app.core.config import get_settings
from app.domains import get_pack
from app.nlu.base import NluPipeline, NluResult, Slots
from app.nlu.metrics import IntentReport, SlotReport, intent_report, slot_pairs, slot_report


@dataclass(frozen=True)
class Example:
    id: str
    text: str
    intent: str
    slots: Slots


@dataclass(frozen=True)
class Evaluation:
    intents: IntentReport
    slots: SlotReport
    predictions: list[NluResult]
    source: str


def load_examples(path: Path) -> list[Example]:
    examples: list[Example] = []
    seen: set[str] = set()
    for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        raw = json.loads(line)
        example = Example(id=raw["id"], text=raw["text"], intent=raw["intent"], slots=raw["slots"])
        if example.id in seen:
            raise ValueError(f"{path.name} {line_no}번째 줄: id 가 중복됩니다 — {example.id}")
        seen.add(example.id)
        examples.append(example)
    return examples


def evaluate(pipeline: NluPipeline, examples: list[Example], labels: tuple[str, ...]) -> Evaluation:
    unknown = sorted({e.intent for e in examples} - set(labels))
    if unknown:
        raise ValueError(f"평가셋에 모르는 의도가 있습니다: {unknown}")
    predictions = [pipeline.parse(e.text) for e in examples]
    return Evaluation(
        intents=intent_report(
            [e.intent for e in examples], [p.intent for p in predictions], labels
        ),
        slots=slot_report([e.slots for e in examples], [p.slots for p in predictions]),
        predictions=predictions,
        source=pipeline.source,
    )


def format_report(result: Evaluation, examples: list[Example], show_errors: bool) -> str:
    lines = [
        f"평가셋 {len(examples)}건 · 방식 {result.source}",
        f"의도  정확도 {result.intents.accuracy:.3f} · macro-F1 {result.intents.macro_f1:.3f}",
    ]
    for label, prf in result.intents.per_intent.items():
        lines.append(
            f"  {label:<24} P {prf.precision:.3f}  R {prf.recall:.3f}  F1 {prf.f1:.3f}  (n={prf.support})"
        )
    micro = result.slots.micro
    lines.append(
        f"슬롯  micro P {micro.precision:.3f} · R {micro.recall:.3f} · F1 {micro.f1:.3f}"
        f" · 발화 단위 완전 일치 {result.slots.exact_match:.3f}"
    )
    for name, prf in result.slots.per_slot.items():
        lines.append(
            f"  {name:<24} P {prf.precision:.3f}  R {prf.recall:.3f}  F1 {prf.f1:.3f}  (n={prf.support})"
        )
    if show_errors:
        lines.append("틀린 발화")
        for example, pred in zip(examples, result.predictions, strict=True):
            slots_ok = slot_pairs(pred.slots) == slot_pairs(example.slots)  # 지표와 같은 비교
            if pred.intent != example.intent or not slots_ok:
                lines.append(f"  [{example.id}] {example.text}")
                if pred.intent != example.intent:
                    lines.append(f"      의도 정답 {example.intent} / 예측 {pred.intent}")
                if not slots_ok:
                    lines.append(f"      슬롯 정답 {example.slots} / 예측 {pred.slots}")
    return "\n".join(lines)


def to_json(result: Evaluation, examples: list[Example]) -> dict[str, Any]:
    return {
        "examples": len(examples),
        "source": result.source,
        "intent": {
            "accuracy": result.intents.accuracy,
            "macro_f1": result.intents.macro_f1,
            "per_intent": {k: asdict(v) for k, v in result.intents.per_intent.items()},
        },
        "slot": {
            "micro": asdict(result.slots.micro),
            "exact_match": result.slots.exact_match,
            "per_slot": {k: asdict(v) for k, v in result.slots.per_slot.items()},
        },
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="BUILDWISE NLU 평가")
    parser.add_argument("--domain", default="hardware", help="도메인 팩 이름")
    parser.add_argument("--file", type=Path, default=None, help="평가셋(JSONL) 경로")
    parser.add_argument("--errors", action="store_true", help="틀린 발화도 출력")
    parser.add_argument("--json", type=Path, default=None, help="결과를 JSON 파일로 저장")
    args = parser.parse_args(argv)

    pack = get_pack(args.domain)
    path = args.file or get_settings().nlu_data_dir / f"{args.domain}_eval_v1.jsonl"
    examples = load_examples(path)
    result = evaluate(pack.nlu(), examples, pack.intent_labels())
    sys.stdout.write(format_report(result, examples, args.errors) + "\n")
    if args.json:
        args.json.write_text(
            json.dumps(to_json(result, examples), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
