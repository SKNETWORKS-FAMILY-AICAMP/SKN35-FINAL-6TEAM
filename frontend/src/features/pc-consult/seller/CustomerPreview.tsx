import { useCallback, useMemo, useRef, useState } from "react";
import type { CompanyPolicy } from "../data/companyPolicy";
import type { ConsultDataSource } from "../data/ConsultDataSource";
import { IntegratedWorkspace } from "../IntegratedWorkspace";
import type { ConsultState } from "../state";
import type { Survey } from "../types";
import type { OfficeState } from "../../office/officeState";
import { teamNotesForOffice } from "../../office/officeNotes";
import type { ChatState } from "../../chat/chatState";
import type { useSellerDemo } from "./useSellerDemo";
import { mockIntervalFromSearch } from "../../../app/mockPace";
import { reviewSelectionHandoffId } from "../reviewSelectionStore";

export interface PreviewOutcome {
  policyVersion: number;
  recommended: string;
  handoff: boolean;
  reasons: string[];
}
export function CustomerPreview({
  policy,
  onOffice,
  onHandoff,
  onOutcome,
  sourceForCompany,
}: {
  policy: CompanyPolicy;
  onOffice: (office: OfficeState) => void;
  onHandoff: ReturnType<typeof useSellerDemo>["receivePreviewHandoff"];
  onOutcome: (outcome: PreviewOutcome) => void;
  sourceForCompany: (policy: CompanyPolicy) => ConsultDataSource;
}) {
  const [appliedPolicy, setAppliedPolicy] = useState(policy);
  const [run, setRun] = useState(0);
  const [survey, setSurvey] = useState<Survey>();
  const [discount, setDiscount] = useState(5);
  const [appliedDiscount, setAppliedDiscount] = useState(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [forwarded, setForwarded] = useState(false);
  const [consult, setConsult] = useState<ConsultState | null>(null);
  const officeRef = useRef<OfficeState | null>(null);
  const chatRef = useRef<ChatState | null>(null);
  const source = useMemo(() => sourceForCompany(appliedPolicy), [appliedPolicy, sourceForCompany]);
  const receiveOffice = useCallback(
    (office: OfficeState) => {
      officeRef.current = office;
      onOffice(office);
    },
    [onOffice],
  );
  const receiveChat = useCallback((chat: ChatState) => {
    chatRef.current = chat;
  }, []);
  const receiveState = useCallback(
    (state: ConsultState) => {
      setConsult(state);
      if (state.candidates)
        onOutcome({
          policyVersion: appliedPolicy.version,
          recommended: state.candidates.passed[0]?.part.name ?? "통과 후보 없음",
          handoff: state.candidates.handoff?.required ?? false,
          reasons: state.candidates.handoff?.reasons ?? [],
        });
    },
    [appliedPolicy.version, onOutcome],
  );
  async function prepare(same: boolean) {
    setLoading(true);
    setError("");
    try {
      const next = same && consult?.survey ? consult.survey : await source.getDemoSurvey?.();
      if (!next) throw new Error("발표용 설문을 준비하지 못했습니다.");
      setSurvey(next);
      setAppliedPolicy(policy);
      setAppliedDiscount(discount);
      setForwarded(false);
      setConsult(null);
      setRun((value) => value + 1);
    } catch (failure) {
      setError(String(failure));
    } finally {
      setLoading(false);
    }
  }
  const handoff =
    consult?.screen === "quote" ? consult.quotes.at(-1)?.handoff : consult?.candidates?.handoff;
  function forward() {
    if (!handoff?.required || !consult || forwarded) return;
    onHandoff({
      id: reviewSelectionHandoffId(appliedPolicy.companyCode, consult.consultationId),
      dataOrigin: "browser-preview",
      reasons: handoff.reasons,
      messages: (chatRef.current?.messages ?? []).map((message) => ({
        speaker: message.role === "user" ? "고객" : "AI 상담 직원",
        text: message.content,
        occurredAt: message.created_at,
      })),
      teamNotes: officeRef.current
        ? teamNotesForOffice(officeRef.current).map((note) => ({
            team: note.team,
            message: note.message,
            occurredAt: note.occurredAt,
          }))
        : [],
    });
    setForwarded(true);
  }
  return (
    <div className="b2b-preview">
      <div className="b2b-page-heading">
        <div>
          <p className="b2b-kicker">손님 입장에서 직접 확인하세요</p>
          <h1>고객 화면 미리보기</h1>
          <p>
            {appliedPolicy.companyName} · 적용 정책 {appliedPolicy.version} · 스냅샷 간이 판단
          </p>
        </div>
        <span className="seller-soft-label">저장·인증은 시연입니다</span>
      </div>
      <section className="seller-card b2b-preview-controls">
        <div>
          <strong>같은 설문으로 정책을 시험합니다.</strong>
          <p>발표용 설문도 실제 스냅샷의 보유 부품을 사용합니다.</p>
        </div>
        <label>
          손님 할인 요청 (%)
          <input
            aria-label="손님 할인 요청"
            type="number"
            min="0"
            max="100"
            value={discount}
            onChange={(event) => setDiscount(Number(event.target.value))}
          />
        </label>
        <button className="seller-secondary" disabled={loading} onClick={() => void prepare(false)}>
          발표용 설문 불러오기
        </button>
        <button className="seller-primary" disabled={loading} onClick={() => void prepare(true)}>
          같은 설문으로 다시 실행
        </button>
      </section>
      {loading && <p role="status">스냅샷에서 설문에 쓸 부품을 찾고 있습니다.</p>}
      {error && (
        <p className="pc-error" role="alert">
          {error}
        </p>
      )}
      {policy.version !== appliedPolicy.version && (
        <p className="b2b-warning">
          정책 {policy.version}이 저장되었습니다. 같은 설문으로 다시 실행하면 새 정책을 적용합니다.
        </p>
      )}
      {handoff?.required && (
        <section className="b2b-handoff-banner">
          <div>
            <strong>AI가 담당자 확인을 요청했습니다.</strong>
            <p>{handoff.reasons.join(" · ")}</p>
          </div>
          <button className="seller-primary" disabled={forwarded} onClick={forward}>
            {forwarded ? "사람 인계함에 전달됨" : "대화와 팀 기록을 사람에게 인계"}
          </button>
        </section>
      )}
      <IntegratedWorkspace
        key={`${policy.companyCode}:${run}`}
        source={source}
        policy={appliedPolicy}
        sessionId={`${policy.companyCode}/preview-${run}`}
        intervalMs={mockIntervalFromSearch(window.location.search)}
        onOffice={receiveOffice}
        initialSurvey={survey}
        requestedDiscountPercent={appliedDiscount}
        onConsultState={receiveState}
        onTranscript={receiveChat}
      />
    </div>
  );
}
