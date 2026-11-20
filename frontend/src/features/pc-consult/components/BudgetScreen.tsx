import { useState, type FormEvent } from "react";
import type { ConsultDataSource } from "../data/ConsultDataSource";
import {
  CATEGORY_LABELS,
  won,
  type BudgetProposal,
  type CandidateRequest,
  type CandidateResult,
} from "../types";
import { StatusBadge } from "./ui";

export function BudgetScreen({
  source,
  request,
  onApply,
  onCancel,
}: {
  source: ConsultDataSource;
  request: CandidateRequest;
  onApply: (proposal: BudgetProposal) => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState(String(Math.round(request.budget)));
  const [proposal, setProposal] = useState<BudgetProposal | null>(null);
  const [preview, setPreview] = useState<CandidateResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = Number(amount);
    if (!Number.isSafeInteger(value) || value <= 0) {
      setError("1원 이상의 금액을 숫자로 입력해 주세요.");
      return;
    }
    setBusy(true);
    setError("");
    setProposal(null);
    setPreview(null);
    try {
      const adjustment = await source.rebalance(request, value);
      const selected = { ...request.selected };
      for (const alternative of adjustment.alternatives)
        selected[alternative.category] = alternative.after;
      const candidates = await source.getCandidates({ ...request, selected, budget: value });
      setProposal(adjustment);
      setPreview(candidates);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "예산을 다시 나누지 못했습니다. 다시 시도해 주세요.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="pc-budget-screen">
      <p className="pc-eyebrow">예산 다시 나누기</p>
      <h1>원하는 부품에 조금 더.</h1>
      <p className="pc-muted">전체 예산을 보면서 다른 부품의 배분을 조정합니다.</p>
      <form className="pc-panel pc-form" onSubmit={submit}>
        <label className="pc-field">
          <span>{CATEGORY_LABELS[request.category]}에 얼마까지 쓰시겠어요?</span>
          <div className="pc-money-input">
            <span>₩</span>
            <input
              autoFocus
              inputMode="numeric"
              aria-label="이 부품 예산"
              value={amount ? Number(amount).toLocaleString("ko-KR") : ""}
              onChange={(event) => {
                setAmount(event.target.value.replace(/[^0-9]/g, ""));
                setProposal(null);
                setPreview(null);
              }}
              disabled={busy}
              aria-describedby={error ? "pc-budget-error" : undefined}
            />
          </div>
        </label>
        <p className="pc-muted">
          전체 예산 {won(request.survey.budget)} · 현재 부품 한도 {won(request.budget)}
        </p>
        {error && (
          <p id="pc-budget-error" className="pc-error" role="alert">
            {error}
          </p>
        )}
        <button className="pc-button pc-primary" disabled={busy}>
          {busy ? "설계팀이 새 구성을 찾고 있습니다…" : "새 후보와 배분 확인"}
        </button>
      </form>
      {proposal && preview && (
        <div className="pc-budget-results">
          <div className="pc-section-heading">
            <h2>새 한도로 찾은 후보</h2>
            <span className="pc-demo-label">간이 판단</span>
          </div>
          <p className="pc-muted">
            {preview.sortLabel} · 통과 {preview.passed.length}개 / 확인 필요{" "}
            {preview.needsReview.length}개
          </p>
          {preview.passed.length === 0 && (
            <p className="pc-warning">
              통과한 후보가 없습니다. 적용 후 확인 필요 후보를 살펴보거나 금액을 바꿔 주세요.
            </p>
          )}
          <div className="pc-preview-list">
            {[
              ...preview.passed.slice(0, 3),
              ...(preview.passed.length === 0 ? preview.needsReview.slice(0, 3) : []),
            ].map(({ part, validation }) => (
              <div key={part.source_key}>
                <span>{part.name}</span>
                <StatusBadge status={validation.status} />
                <strong>
                  {won(part.current_price ?? 0)} <small>테스트 가격</small>
                </strong>
              </div>
            ))}
          </div>
          <h2>선택한 부품의 대체 제안</h2>
          <p>{proposal.explanation}</p>
          {proposal.alternatives.map((alternative) => (
            <div className="pc-alternative" key={alternative.category}>
              <strong>{CATEGORY_LABELS[alternative.category]}</strong>
              <div>
                <span>현재 선택</span>
                <p>{alternative.before.name}</p>
                <b>{won(alternative.before.current_price ?? 0)}</b>
              </div>
              <span aria-hidden="true">→</span>
              <div>
                <span>더 저렴한 후보</span>
                <p>{alternative.after.name}</p>
                <b>{won(alternative.after.current_price ?? 0)}</b>
                <StatusBadge status={alternative.validation.status} />
              </div>
            </div>
          ))}
          <div className="pc-comparison">
            <div>
              <span>한도 변경 후 · 대체 전 예상 합계</span>
              <strong>{won(proposal.beforeTotal)}</strong>
            </div>
            <span aria-hidden="true">→</span>
            <div>
              <span>한도 변경 후 · 대체 후 예상 합계</span>
              <strong>{won(proposal.afterTotal)}</strong>
            </div>
          </div>
          <p className="pc-footnote">
            선택하지 않은 부품은 배정액으로 계산한 예상 금액입니다. 실제 견적은 부품 선택 후
            정해집니다. 모든 가격은 테스트 가격입니다.
          </p>
          {proposal.afterTotal > request.survey.budget && (
            <p className="pc-error">
              예산보다 {won(proposal.afterTotal - request.survey.budget)} 많습니다. 한도나 다른
              부품을 더 조정해 주세요.
            </p>
          )}
          <div className="pc-actions pc-bottom-actions">
            <button className="pc-button pc-secondary" onClick={onCancel}>
              거절하고 기존 구성 유지
            </button>
            <button className="pc-button pc-primary" onClick={() => onApply(proposal)}>
              {proposal.alternatives.length ? "대체안과 배분 적용" : "이 한도로 후보 보기"}
            </button>
          </div>
        </div>
      )}
      {!proposal && (
        <div className="pc-actions pc-bottom-actions">
          <button className="pc-button pc-ghost" onClick={onCancel} disabled={busy}>
            ← 후보로 돌아가기
          </button>
        </div>
      )}
    </section>
  );
}
