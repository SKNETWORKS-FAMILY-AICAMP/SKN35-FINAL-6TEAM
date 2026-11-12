import { useEffect, useState } from "react";
import { api, errorMessage, type Company } from "../api/client";
import { ChatPanel } from "../features/chat/ChatPanel";
import { useChat } from "../features/chat/useChat";
import { useMockTranscript } from "../features/chat/mockTranscript";
import { ConsultationForm } from "../features/consultation/ConsultationForm";
import { OfficeBoard } from "../features/office/OfficeBoard";
import { OfficeDemoResults } from "../features/office/OfficeDemoResults";
import { OrderButton } from "../features/orders/OrderButton";
import { QuotationTable } from "../features/quotations/QuotationTable";
import { RecommendationList } from "../features/recommendations/RecommendationList";
import { useConsultation } from "./useConsultation";

const MOCK = new URLSearchParams(window.location.search).has("mock");

const CONNECTION_LABEL = {
  connecting: "연결 중",
  open: "실시간 연결됨",
  reconnecting: "다시 연결 중",
  closed: "연결 끊김",
} as const;

function Workspace({ company, onReplay }: { company: Company | null; onReplay: () => void }) {
  const { office, connection, recommendations, quotation, error, submit, retry, sessionId } =
    useConsultation(company, MOCK);
  const { chat, sendChat } = useChat(MOCK ? null : sessionId, company?.id ?? null);
  const mockTranscript = useMockTranscript(office, MOCK);

  return (
    <>
      <div className="workspace-intro">
        <div>
          <p className="workspace-kicker">YOUR AI WORKSPACE</p>
          <h2>
            당신의 AI 팀이 일하는 공간<span>.</span>
          </h2>
          <p className="workspace-description">
            목소리로 요청하고, 팀의 실행을 실시간으로 확인하세요.
          </p>
        </div>
        <div className="workspace-connection">
          <p
            className="connection"
            data-testid="connection"
            data-state={MOCK ? "demo" : connection}
          >
            <i aria-hidden="true" />
            {MOCK
              ? office.runStatus === "completed"
                ? "데모 완료"
                : "데모 시나리오 재생"
              : CONNECTION_LABEL[connection]}
          </p>
          {MOCK ? (
            <button type="button" className="demo-replay" onClick={onReplay}>
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M4 7a6.5 6.5 0 1 1-.5 5M4 3v4h4" />
              </svg>
              데모 다시 보기
            </button>
          ) : (
            <span className="workspace-session">
              {sessionId ? `세션 ${sessionId.slice(0, 8)}` : "상담을 준비하고 있어요"}
            </span>
          )}
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="layout">
        <div className="consultation-workspace">
          <ChatPanel
            key={sessionId ?? "preview"}
            state={MOCK ? mockTranscript.chat : chat}
            disabled={MOCK || !sessionId}
            onSend={sendChat}
            mock={MOCK}
            mockDraft={mockTranscript.draft}
            mockDraftAt={mockTranscript.draftAt}
          />
          <OfficeBoard state={office} onRetry={retry} />
        </div>
        <section className="workspace-results" id="results" aria-labelledby="results-title">
          <div className="results-heading">
            <div>
              <p className="workspace-kicker">DELIVERABLES</p>
              <h2 id="results-title">
                대화에서, 결정까지<span>.</span>
              </h2>
            </div>
            <p>
              {MOCK
                ? "수신된 데모 이벤트를 바탕으로 표시합니다."
                : "추천 후보와 견적을 한곳에서 확인하세요."}
            </p>
          </div>
          {MOCK ? (
            <OfficeDemoResults state={office} />
          ) : (
            <div className={`results-grid${company ? " has-form" : ""}`}>
              {company && (
                <div className="column">
                  <ConsultationForm
                    company={company}
                    disabled={MOCK || !sessionId}
                    onSubmit={submit}
                  />
                </div>
              )}
              <div className="column wide">
                <RecommendationList items={recommendations} />
              </div>
              <div className="column">
                <QuotationTable quotation={quotation} companyName={company?.name} />
                {company && <OrderButton companyId={company.id} quotation={quotation} />}
              </div>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

export function App() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [demoRun, setDemoRun] = useState(0);
  const [activeSection, setActiveSection] = useState(window.location.hash || "#workspace");

  useEffect(() => {
    const updateSection = () => setActiveSection(window.location.hash || "#workspace");
    window.addEventListener("hashchange", updateSection);
    return () => window.removeEventListener("hashchange", updateSection);
  }, []);

  useEffect(() => {
    if (MOCK) return;
    api.GET("/api/companies").then(({ data, error }) => {
      if (data) {
        setCompanies(data);
        setCompanyId(data[0]?.id ?? null);
      } else {
        setLoadError(errorMessage(error));
      }
    });
  }, []);

  const company = companies.find((c) => c.id === companyId) ?? null;

  return (
    <div className="app-shell">
      <aside className="app-rail" aria-label="워크스페이스 탐색">
        <a className="brand" href="#workspace" aria-label="BUILDWISE 워크스페이스">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 28 28" width="28" height="28" shapeRendering="crispEdges">
              <path d="M4 4h8v8H4Zm12 0h8v8h-8ZM4 16h8v8H4Z" fill="currentColor" />
              <path d="M16 16h4v4h4v4h-8Z" fill="#c5dcae" />
            </svg>
          </span>
        </a>
        <nav className="workspace-nav" aria-label="화면 바로가기">
          <a
            href="#workspace"
            aria-label="워크스페이스"
            aria-current={activeSection === "#workspace" ? "location" : undefined}
          >
            <NavigationIcon kind="office" />
            <span>오피스</span>
          </a>
          <a
            href="#conversation"
            aria-label="음성 상담"
            aria-current={activeSection === "#conversation" ? "location" : undefined}
          >
            <NavigationIcon kind="voice" />
            <span>상담</span>
          </a>
          <a
            href="#results"
            aria-label="추천 · 견적"
            aria-current={activeSection === "#results" ? "location" : undefined}
          >
            <NavigationIcon kind="results" />
            <span>결과</span>
          </a>
        </nav>
        <span className="rail-caption">
          AI
          <br />
          OFFICE
        </span>
      </aside>
      <main>
        <header className="top">
          <div className="brand-wordmark">
            <h1>
              BUILDWISE<span>OFFICE</span>
            </h1>
            <span className="header-divider" aria-hidden="true" />
            <span className="header-context">AI 팀 워크스페이스</span>
          </div>
          <span className="badge" data-testid="test-data-badge">
            <span aria-hidden="true" className="badge-dot" />
            테스트 데이터 · Mock
          </span>
          {companies.length > 0 && (
            <label className="company">
              기업(시연용 전환 · 인증 아님)
              <select
                value={companyId ?? ""}
                onChange={(e) => setCompanyId(Number(e.target.value))}
                data-testid="company"
              >
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </header>
        {loadError && <p className="error">기업 목록을 불러오지 못했습니다: {loadError}</p>}
        <Workspace
          key={`${company?.id ?? "none"}:${demoRun}`}
          company={company}
          onReplay={() => setDemoRun((run) => run + 1)}
        />
        <footer className="workspace-footer">
          <span>
            BUILDWISE <b>대화와 실행이 연결되는 곳</b>
          </span>
          <span>가상 브랜드 · 테스트 데이터</span>
        </footer>
      </main>
    </div>
  );
}

function NavigationIcon({ kind }: { kind: "office" | "voice" | "results" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {kind === "office" && <path d="M4 4h6v6H4Zm10 0h6v6h-6ZM4 14h6v6H4Zm10 0h6v6h-6Z" />}
      {kind === "voice" && (
        <>
          <rect x="9" y="3" width="6" height="12" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
        </>
      )}
      {kind === "results" && (
        <>
          <path d="M6 3h8l4 4v14H6V3ZM14 3v5h4M9 12h6M9 16h6" />
        </>
      )}
    </svg>
  );
}
