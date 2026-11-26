import { useState } from "react";
import { won, type Candidate, type CandidateResult, type FanSelection, type Part } from "../types";
import { CandidateCard } from "./CandidateCard";

function method(candidate: Candidate) {
  if (candidate.cooling_mode === "bundled") return "CPU 동봉 쿨러 사용";
  if (candidate.cooling_mode === "reuse") return "보유 쿨러 재사용";
  const size = candidate.part.specs.radiator_size_mm;
  return typeof size === "number" && size > 0 ? `CPU 수냉 · ${size} mm` : "CPU 공랭";
}

export function CoolingPicker({
  result,
  selected,
  budget,
  visible,
  onMore,
  onNext,
}: {
  result: CandidateResult;
  selected?: Part;
  budget: number;
  visible: number;
  onMore: () => void;
  onNext: (candidate: Candidate, fans: FanSelection[]) => void;
}) {
  const coolers = result.passed.filter((c) => c.part.specs.cooling_type !== "case_fan");
  const recommendedFan = result.passed.find(
    (c) => c.part.specs.cooling_type === "case_fan" && c.recommended,
  );
  const [counts, setCounts] = useState<Record<number, number>>(() =>
    Object.fromEntries((selected?.cooling?.fans ?? []).map((f) => [f.part.part_id, f.quantity])),
  );
  const parts = result.fans ?? [];
  const fans = parts.flatMap((part) =>
    counts[part.part_id] > 0 ? [{ part, quantity: counts[part.part_id] }] : [],
  );
  const fanCost = fans.reduce((sum, f) => sum + (f.part.current_price ?? 0) * f.quantity, 0);
  return (
    <div className="pc-cooling-picker">
      {parts.length > 0 && (
        <details className="pc-fan-options" open={Boolean(recommendedFan || fans.length)}>
          <summary>추가 케이스 팬{fanCost > 0 && ` · ${won(fanCost)}`}</summary>
          <div className="pc-candidate-list">
            <p>함께 담을 팬 수량을 정한 뒤 CPU 쿨러를 선택하세요.</p>
            {parts.map((part) => {
              const advice =
                recommendedFan?.part.part_id === part.part_id ? recommendedFan : undefined;
              return (
                <CandidateCard
                  key={part.source_key}
                  candidate={advice ?? { part }}
                  description={advice && `${coolers[0].part.name}와 함께 1개 추천`}
                  action={
                    <label>
                      수량{" "}
                      <input
                        type="number"
                        min={0}
                        max={32}
                        step={1}
                        value={counts[part.part_id] ?? 0}
                        aria-label={part.name + " 수량"}
                        onChange={(e) => {
                          const count = e.currentTarget.valueAsNumber;
                          setCounts((prev) => ({
                            ...prev,
                            [part.part_id]: Number.isFinite(count)
                              ? Math.min(32, Math.max(0, Math.floor(count)))
                              : 0,
                          }));
                        }}
                      />
                    </label>
                  }
                />
              );
            })}
          </div>
        </details>
      )}
      <div className="pc-candidate-list">
        <h3>CPU 쿨러</h3>
        {coolers.slice(0, visible).map((candidate) => {
          const total = (candidate.part.current_price ?? 0) + fanCost;
          const detail = fanCost
            ? ` · 팬 포함 ${won(total)}${total > budget ? " (예산 초과)" : ""}`
            : "";
          return (
            <CandidateCard
              key={candidate.part.source_key}
              candidate={candidate}
              description={method(candidate) + detail}
              disabled={total > budget}
              onChoose={() => onNext(candidate, fans)}
            />
          );
        })}
        {visible < coolers.length && (
          <button className="pc-button pc-more" onClick={onMore}>
            후보 더 보기 ({visible}/{coolers.length})
          </button>
        )}
      </div>
    </div>
  );
}
