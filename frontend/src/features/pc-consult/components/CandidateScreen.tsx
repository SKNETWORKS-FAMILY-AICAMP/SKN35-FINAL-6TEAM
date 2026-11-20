import { useState } from "react";
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

interface Props {
  category: Category;
  result: CandidateResult | null;
  progress: Progress | null;
  pending: boolean;
  error: string | null;
  budget: number;
  reason?: string;
  onChoose: (candidate: Candidate, allowUnknown?: boolean) => void;
  onRetry: () => void;
  onBudget: () => void;
  onBack: () => void;
  onEditSurvey: () => void;
  canBudget: boolean;
  editing: boolean;
}

function CandidateCard({ candidate, onChoose }: { candidate: Candidate; onChoose: () => void }) {
  const { part, validation, recommended } = candidate;
  return (
    <article
      className={`pc-candidate${recommended ? " pc-recommended" : ""}`}
      data-testid="pc-candidate"
      data-source-key={part.source_key}
    >
      {recommended && (
        <div className="pc-recommendation">
          <span>✦ 추천</span>
          <span>{candidate.reason}</span>
        </div>
      )}
      <div className="pc-candidate-main">
        <PartGlyph category={part.category} />
        <div className="pc-product">
          <span className="pc-eyebrow">{part.brand}</span>
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
      <div className="pc-candidate-validation">
        <div className="pc-badge-row">
          <StatusBadge status={validation.status} />
        </div>
        <ValidationDetails validation={validation} />
      </div>
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
  reason,
  onChoose,
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
  const phase = progress?.phase;
  const message =
    phase === "loading"
      ? "부품 카탈로그을 불러오고 있습니다."
      : phase === "validation"
        ? `검증팀이 호환성을 확인하고 있습니다 (${progress?.completed ?? 0}/${progress?.total ?? 0})`
        : phase === "ready"
          ? "팀이 검증 결과를 정리하고 있습니다."
          : `설계팀이 ${label} 후보를 찾고 있습니다.`;
  return (
    <section className="pc-selection" aria-busy={pending}>
      <div className="pc-section-heading">
        <div>
          <p className="pc-eyebrow">DESIGN & VALIDATION</p>
          <h1>{editing ? `${label}, 다시 골라 주세요.` : `${label} 후보를 골라 주세요.`}</h1>
          <p className="pc-muted">{reason || "앞서 고른 부품과 예산을 반영했습니다."}</p>
        </div>
        <span className="pc-budget-chip">
          이 부품 한도 <strong>{won(budget)}</strong>
        </span>
      </div>
      <div className="pc-team-status" role="status">
        <span className={`pc-status-dot${pending ? " pc-working" : ""}`} />
        {pending ? message : error ? "작업을 마치지 못했습니다." : "설계팀이 후보를 정리했습니다."}
      </div>
      {pending ? (
        <div className="pc-loading">
          <div className="pc-spinner" />
          <h2>{message}</h2>
          <p>
            {phase === "ready"
              ? "잠시 후 후보와 확인할 조건을 보여 드립니다."
              : "제공된 부품과 제조사 근거를 읽고 있습니다."}
          </p>
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
            <div className="pc-list-toolbar">
              <p>{result.sortLabel}</p>
              {canBudget && (
                <button className="pc-button pc-secondary" onClick={onBudget}>
                  이 부품에 예산 더 쓰기 <span aria-hidden="true">↗</span>
                </button>
              )}
            </div>
            <details className="pc-criteria" open>
              <summary>후보에 적용한 기준</summary>
              <ul>
                {result.criteria.map((criterion) => (
                  <li key={criterion}>{criterion}</li>
                ))}
              </ul>
            </details>
            <div className="pc-list-title">
              <h2>
                현재 조건을 통과한 후보 <span>{result.passed.length}</span>
              </h2>
              <span className="pc-muted">조건부 후보는 조건을 확인해 주세요.</span>
            </div>
            {result.passed.length === 0 && (
              <div className="pc-empty">
                <PartGlyph category={category} />
                <h2>지금 조건에 맞는 통과 후보가 없습니다.</h2>
                <p>예산과 조건을 바꾸거나, 아래에서 확인이 더 필요한 후보를 살펴보세요.</p>
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
            <div className="pc-candidate-list">
              {result.passed.slice(0, visible).map((candidate) => (
                <CandidateCard
                  key={candidate.part.source_key}
                  candidate={candidate}
                  onChoose={() => onChoose(candidate)}
                />
              ))}
            </div>
            {visible < result.passed.length && (
              <button
                className="pc-button pc-more"
                onClick={() => setVisible((count) => count + 10)}
              >
                후보 더 보기 ({Math.min(visible, result.passed.length)}/{result.passed.length})
              </button>
            )}
            <details className="pc-unknown" data-testid="pc-unknown">
              <summary>
                <span>
                  확인이 더 필요한 후보 <strong>{result.needsReview.length}</strong>
                </span>
                <span className="pc-muted">확인 불가 · 펼쳐 보기</span>
              </summary>
              <div className="pc-unknown-body">
                <p className="pc-warning">
                  사양 또는 제조사 근거가 부족합니다. 이 후보는 호환성 통과나 AI 추천으로 분류하지
                  않습니다.
                </p>
                {result.needsReview.slice(0, unknownVisible).map((candidate) => (
                  <CandidateCard
                    key={candidate.part.source_key}
                    candidate={candidate}
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
                {result.needsReview.length === 0 && <p>확인 불가 후보가 없습니다.</p>}
              </div>
            </details>
            <p className="pc-footnote">
              호환 불가 후보 {result.rejectedCount}개 제외
              {result.missingColorCount > 0
                ? ` · 색상 정보 없음 ${result.missingColorCount}개 (색상 조건 확인 불가)`
                : ""}
              . 제조사 확인이 필요한 조건을 함께 확인해 주세요.
            </p>
          </>
        )
      )}
      <div className="pc-actions pc-bottom-actions">
        <button className="pc-button pc-ghost" onClick={onBack}>
          ← {editing ? "견적으로 돌아가기" : "이전 단계"}
        </button>
        <span className="pc-muted">부품을 선택하면 다음으로 이동합니다.</span>
      </div>
      {warning && (
        <Modal title="확인하지 못한 항목이 있습니다" onClose={() => setWarning(null)}>
          <p>{warning.part.name}</p>
          <ValidationDetails validation={warning.validation} />
          <p className="pc-warning">
            선택해도 호환성 통과로 바뀌지 않습니다. 견적에도 확인 필요 사항이 남습니다.
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
