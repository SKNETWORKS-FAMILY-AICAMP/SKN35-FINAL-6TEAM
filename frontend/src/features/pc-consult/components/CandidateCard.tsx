import type { ReactNode } from "react";
import { won, priceLabel, type Candidate } from "../types";
import { PartSpecs, StatusBadge } from "./ui";
import { PartVisual } from "./PartVisual";

export function CandidateCard({
  candidate,
  onChoose,
  reviewOnly = false,
  disabled = false,
  description,
  action,
}: {
  candidate: Pick<Candidate, "part"> & Partial<Candidate>;
  onChoose?: () => void;
  disabled?: boolean;
  description?: string;
  action?: ReactNode;
  reviewOnly?: boolean;
}) {
  const { part, validation } = candidate;
  const recommended =
    !reviewOnly &&
    candidate.recommended &&
    (validation?.status === "PASS" || validation?.status === "CONDITIONAL");
  return (
    <article
      className={`pc-candidate${recommended ? " pc-recommended" : ""}`}
      data-testid="pc-candidate"
      data-source-key={part.source_key}
    >
      {recommended && (
        <div className="pc-recommendation">
          <span>✦ AI 추천</span>
        </div>
      )}
      <div className="pc-candidate-main">
        <PartVisual category={part.category} name={part.name} imageUrl={part.image_url} />
        <div className="pc-product">
          <span className="pc-eyebrow">
            {!part.brand || /^(unknown|unconfirmed|unverified)$/i.test(part.brand)
              ? "브랜드 미확인"
              : part.brand}
          </span>
          <h3>{part.name}</h3>
          {description && <p>{description}</p>}
          {recommended && part.category === "cooler" && candidate.reason && (
            <p>{candidate.reason}</p>
          )}
          <PartSpecs part={part} />
          <div className="pc-product-meta">
            <span>{part.specs.color ? `색상: ${String(part.specs.color)}` : "색상 정보 없음"}</span>
            {part.power_draw_w != null && (
              <span>
                소비 전력 {part.power_draw_w}W{part.power_status === "unconfirmed" ? " · 추정" : ""}
              </span>
            )}
          </div>
        </div>
        <div className="pc-candidate-price">
          <strong>{part.current_price == null ? "가격 미확인" : won(part.current_price)}</strong>
          <small>{priceLabel(part)}</small>
          {action ?? (
            <button
              className="pc-button pc-primary"
              type="button"
              onClick={onChoose}
              disabled={disabled}
              aria-label={`${part.name} 선택`}
            >
              이 부품 선택 <span aria-hidden="true">→</span>
            </button>
          )}
        </div>
      </div>
      {validation && validation.status !== "PASS" && <StatusBadge status={validation.status} />}
    </article>
  );
}
