import {
  CATEGORIES,
  CATEGORY_LABELS,
  won,
  priceLabel,
  selectionLines,
  type Category,
  type SelectionMap,
} from "../types";
import { PartGlyph } from "./ui";
import { PartVisual } from "./PartVisual";

export function SummaryPanel({
  selected,
  budget,
  needsReview,
  steps,
  onVisit,
}: {
  selected: SelectionMap;
  budget: number;
  needsReview: Category[];
  steps: Category[];
  onVisit?: (index: number) => void;
}) {
  const lines = selectionLines(selected);
  const total = lines.reduce(
    (sum, { part, quantity }) => sum + (part.current_price ?? 0) * quantity,
    0,
  );
  const completePrice = lines.every(({ part }) => part.current_price != null);
  const remaining = budget - total;
  return (
    <aside className="pc-summary-panel" aria-label="선택한 부품과 예산">
      <div className="pc-summary-header">
        <span className="pc-eyebrow">내 PC 구성</span>
        <h2>지금까지 고른 부품</h2>
        <span>
          {Object.keys(selected).length} / {steps.length}개
        </span>
      </div>
      <ul className="pc-build-list">
        {CATEGORIES.filter((category) => steps.includes(category)).map((category) => {
          const part = selected[category];
          return (
            <li key={category}>
              {part ? (
                <PartVisual
                  category={category}
                  name={part.name}
                  imageUrl={part.image_url}
                  size="compact"
                  caption={false}
                />
              ) : (
                <PartGlyph category={category} />
              )}
              <div>
                <span className="pc-build-category">{CATEGORY_LABELS[category]}</span>
                {part ? (
                  <>
                    <strong>{part.name}</strong>
                    <small>
                      {won(part.current_price)} · {priceLabel(part)}
                    </small>
                    {part.cooling?.fans.map((f) => (
                      <small key={f.part.part_id}>
                        {f.part.name} × {f.quantity}
                      </small>
                    ))}
                    {needsReview.includes(category) && (
                      <span className="pc-review-label">다시 확인 필요</span>
                    )}
                    {onVisit && (
                      <button
                        className="pc-inline-button"
                        onClick={() => onVisit(steps.indexOf(category))}
                      >
                        {needsReview.includes(category) ? "다시 확인" : "변경"}
                      </button>
                    )}
                  </>
                ) : (
                  <span className="pc-muted">아직 고르지 않았어요</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <dl className="pc-totals">
        <div>
          <dt>전체 예산</dt>
          <dd>{won(budget)}</dd>
        </div>
        <div className="pc-total">
          <dt>현재 합계</dt>
          <dd>{completePrice ? won(total) : "가격 확인 필요"}</dd>
        </div>
        <div className={remaining < 0 ? "pc-over-budget" : "pc-remaining"}>
          <dt>{remaining < 0 ? "예산 초과" : "남은 예산"}</dt>
          <dd>{completePrice ? won(Math.abs(remaining)) : "가격 확인 필요"}</dd>
        </div>
      </dl>
      {remaining < 0 && (
        <p className="pc-error" role="status">
          예산보다 {won(-remaining)} 초과했습니다.
        </p>
      )}
      <p className="pc-footnote">선택한 구매 부품만 합산합니다.</p>
    </aside>
  );
}
