import { useState } from "react";
import { won, type Candidate, type CandidateResult, type FanSelection, type Part } from "../types";

function method(candidate: Candidate) {
  if (candidate.cooling_mode === "bundled") return "기본 쿨러 사용";
  if (candidate.cooling_mode === "reuse") return "기존 쿨러 재사용";
  const radiator = candidate.part.specs.radiator_size_mm;
  return typeof radiator === "number" && radiator > 0 ? `수냉 · ${radiator} mm` : "CPU 공랭";
}

export function CoolingPicker({
  result,
  selected,
  budget,
  onNext,
}: {
  result: CandidateResult;
  selected?: Part;
  budget: number;
  onNext: (candidate: Candidate, fans: FanSelection[]) => void;
}) {
  const initial =
    result.passed.find((c) => c.part.part_id === selected?.part_id) ??
    result.passed.find((c) => c.recommended) ??
    result.passed[0];
  const [id, setId] = useState(initial?.part.part_id);
  const [counts, setCounts] = useState<Record<number, number>>(() =>
    Object.fromEntries((selected?.cooling?.fans ?? []).map((f) => [f.part.part_id, f.quantity])),
  );
  const choice = result.passed.find((c) => c.part.part_id === id);
  const fans = (result.fans ?? []).flatMap((part) =>
    counts[part.part_id] > 0 ? [{ part, quantity: counts[part.part_id] }] : [],
  );
  const total =
    (choice?.part.current_price ?? 0) +
    fans.reduce((sum, f) => sum + (f.part.current_price ?? 0) * f.quantity, 0);
  return (
    <div className="pc-cooling-picker">
      <fieldset>
        <legend>CPU 냉각 방식</legend>
        {result.passed.map((c) => (
          <label key={c.part.source_key} className="pc-cooling-option">
            <input
              type="radio"
              name="cpu-cooling"
              checked={c.part.part_id === id}
              onChange={() => setId(c.part.part_id)}
            />
            <span>
              <strong>{method(c)}</strong> · {c.part.name} {c.recommended && <b>AI 추천</b>}
            </span>
            <span>{won(c.part.current_price)}</span>
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>추가 케이스 팬</legend>
        {(result.fans ?? []).map((part) => (
          <label key={part.source_key} className="pc-cooling-option">
            <span>
              {part.name} · {won(part.current_price)}
            </span>
            <input
              type="number"
              min={0}
              max={32}
              step={1}
              aria-label={part.name + " 수량"}
              value={counts[part.part_id] ?? 0}
              onChange={(e) => {
                const value = e.currentTarget.valueAsNumber;
                setCounts({
                  ...counts,
                  [part.part_id]: Number.isFinite(value)
                    ? Math.min(32, Math.max(0, Math.floor(value)))
                    : 0,
                });
              }}
            />
          </label>
        ))}
        {!result.fans?.length && <p>선택 가능한 추가 팬이 없습니다.</p>}
      </fieldset>
      <div className="pc-actions">
        <strong>{won(total)}</strong>
        {total > budget && <span role="status">쿨러 예산을 초과했습니다.</span>}
        <button
          className="pc-button pc-primary"
          disabled={!choice || total > budget}
          onClick={() => choice && onNext(choice, fans)}
        >
          다음
        </button>
      </div>
    </div>
  );
}
