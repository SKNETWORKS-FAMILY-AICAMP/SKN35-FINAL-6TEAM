import { useState } from "react";
import { CoolingPicker } from "./CoolingPicker";
import type { FanSelection, Part } from "../types";
import {
  CATEGORY_LABELS,
  won,
  priceLabel,
  type Candidate,
  type CandidateResult,
  type Category,
  type Progress,
} from "../types";
import { Modal, PartGlyph, PartSpecs, StatusBadge, ValidationDetails } from "./ui";
import { PartVisual } from "./PartVisual";

interface Props {
  category: Category;
  result: CandidateResult | null;
  progress: Progress | null;
  pending: boolean;
  error: string | null;
  budget: number;
  onChoose: (candidate: Candidate, allowUnknown?: boolean, fans?: FanSelection[]) => void;
  selectedCooler?: Part;
  onRetry: () => void;
  onBudget: () => void;
  onBack: () => void;
  onEditSurvey: () => void;
  canBudget: boolean;
  editing: boolean;
}

function CandidateCard({
  candidate,
  onChoose,
  reviewOnly = false,
}: {
  candidate: Candidate;
  onChoose: () => void;
  reviewOnly?: boolean;
}) {
  const { part, validation } = candidate;
  const recommended =
    !reviewOnly &&
    candidate.recommended &&
    (validation.status === "PASS" || validation.status === "CONDITIONAL");
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
          <button
            className="pc-button pc-primary"
            type="button"
            onClick={onChoose}
            aria-label={`${part.name} 선택`}
          >
            이 부품 선택 <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>
      {validation.status !== "PASS" && <StatusBadge status={validation.status} />}
    </article>
  );
}

export function CandidateScreen({
  category,
  result,
  progress,
  pending,
  error,
  budget,
  onChoose,
  selectedCooler,
  onRetry,
  onBudget,
  onBack,
  onEditSurvey,
  canBudget,
  editing,
}: Props) {
  const [visible, setVisible] = useState(10);
  const [unknownVisible, setUnknownVisible] = useState(10);
  const [warning, setWarning] = useState<Candidate | null>(null);
  const label = CATEGORY_LABELS[category];
  const onlyReview = Boolean(result && !result.passed.length && result.needsReview.length);
  const phase = progress?.phase;
  const message =
    phase === "loading"
      ? "부품 카탈로그를 불러오고 있습니다."
      : phase === "validation"
        ? `검증팀이 호환성을 확인하고 있습니다 (${progress?.completed ?? 0}/${progress?.total ?? 0})`
        : phase === "ready"
          ? "팀이 검증 결과를 정리하고 있습니다."
          : `설계팀이 ${label} 후보를 찾고 있습니다.`;
  const reviewList = result && (
    <details
      className={`pc-unknown${onlyReview ? " pc-unknown-primary" : ""}`}
      data-testid="pc-unknown"
      open={onlyReview}
    >
      <summary>
        <span>
          확인이 필요한 후보
          <strong>{result.needsReview.length}</strong>
        </span>
      </summary>
      <div className="pc-unknown-body">
        {result.needsReview.slice(0, unknownVisible).map((candidate) => (
          <CandidateCard
            key={candidate.part.source_key}
            candidate={candidate}
            reviewOnly
            onChoose={() => setWarning(candidate)}
          />
        ))}
        {unknownVisible < result.needsReview.length && (
          <button
            className="pc-button pc-more"
            onClick={() => setUnknownVisible((count) => count + 10)}
          >
            확인 필요 후보 더 보기
          </button>
        )}
      </div>
    </details>
  );
  const toolbar = result && (
    <div className="pc-list-toolbar">
      {canBudget && (
        <button className="pc-button pc-secondary" onClick={onBudget}>
          이 부품에 예산 더 쓰기 <span aria-hidden="true">↗</span>
        </button>
      )}
    </div>
  );
  return (
    <section className="pc-selection" aria-busy={pending}>
      <div className="pc-section-heading">
        <div>
          <h1>{editing ? `${label}, 다시 골라 주세요.` : `${label} 후보를 골라 주세요.`}</h1>
        </div>
        <span className="pc-budget-chip">
          이 부품 한도 <strong>{won(budget)}</strong>
        </span>
      </div>
      {pending ? (
        <div className="pc-loading" role="status">
          <div className="pc-spinner" />
          <h2>{message}</h2>
        </div>
      ) : error ? (
        <div className="pc-empty" role="alert">
          <h2>후보를 불러오지 못했습니다.</h2>
          <p>{error}</p>
          <button className="pc-button pc-primary" onClick={onRetry}>
            다시 시도
          </button>
        </div>
      ) : (
        result && (
          <>
            {onlyReview && toolbar}
            {onlyReview && reviewList}
            {result.policyLabel && <p className="pc-notice">{result.policyLabel}</p>}
            {result.handoff?.required && (
              <div className="pc-warning" role="status">
                <strong>담당자가 확인해야 합니다.</strong>
                <ul>
                  {result.handoff.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
                <p>
                  후보를 살펴보실 수 있지만, 담당자 확인이 필요한 견적은 자동 확정하지 않습니다.
                </p>
              </div>
            )}
            {!onlyReview && toolbar}
            {result.passed.length > 0 && (
              <div className="pc-list-title">
                <h2>
                  후보 <span>{result.passed.length}</span>
                </h2>
              </div>
            )}
            {result.passed.length === 0 && result.needsReview.length === 0 && (
              <div className="pc-empty">
                <PartGlyph category={category} />
                <h2>지금 조건에 맞는 후보가 없습니다.</h2>
                <div className="pc-actions">
                  {canBudget && (
                    <button className="pc-button pc-primary" onClick={onBudget}>
                      예산 다시 나누기
                    </button>
                  )}
                  <button className="pc-button pc-secondary" onClick={onEditSurvey}>
                    설문 조건 바꾸기
                  </button>
                  <button className="pc-button pc-ghost" onClick={onBack}>
                    이전으로
                  </button>
                </div>
              </div>
            )}
            {category === "cooler" && result.basis === "api" && result.passed.length > 0 ? (
              <CoolingPicker
                result={result}
                selected={selectedCooler}
                budget={budget}
                onNext={(choice, fans) => onChoose(choice, false, fans)}
              />
            ) : (
              <div className="pc-candidate-list">
                {result.passed.slice(0, visible).map((candidate) => (
                  <CandidateCard
                    key={candidate.part.source_key}
                    candidate={candidate}
                    onChoose={() => onChoose(candidate)}
                  />
                ))}
              </div>
            )}
            {!(category === "cooler" && result.basis === "api") &&
              visible < result.passed.length && (
                <button
                  className="pc-button pc-more"
                  onClick={() => setVisible((count) => count + 10)}
                >
                  후보 더 보기 ({Math.min(visible, result.passed.length)}/{result.passed.length})
                </button>
              )}
            {result.passed.length > 0 && result.needsReview.length > 0 && reviewList}
          </>
        )
      )}
      <div className="pc-actions pc-bottom-actions">
        <button className="pc-button pc-ghost" onClick={onBack}>
          ← {editing ? "견적으로 돌아가기" : "이전 단계"}
        </button>
      </div>
      {warning && (
        <Modal title="확인하지 못한 항목이 있습니다" onClose={() => setWarning(null)}>
          <p>{warning.part.name}</p>
          <ValidationDetails
            validation={{
              ...warning.validation,
              checks: warning.validation.checks.filter((check) => check.status === "UNKNOWN"),
            }}
          />
          <p className="pc-warning">
            확인 필요 상태로 견적에 담습니다. 호환성 통과로 바뀌지 않습니다.
          </p>
          <div className="pc-actions">
            <button className="pc-button pc-secondary" onClick={() => setWarning(null)}>
              다른 후보 보기
            </button>
            <button
              className="pc-button pc-primary"
              onClick={() => {
                onChoose(warning, true);
                setWarning(null);
              }}
            >
              주의사항을 확인하고 선택
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
