import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { api, errorMessage, type Company } from "../api/client";
import type { ConnectionState } from "../events/eventStream";
import { ChatPanel } from "../features/chat/ChatPanel";
import { useChat } from "../features/chat/useChat";
import { useMockTranscript } from "../features/chat/mockTranscript";
import { ConsultationForm } from "../features/consultation/ConsultationForm";
import { OfficeBoard } from "../features/office/OfficeBoard";
import { OfficeDemoResults } from "../features/office/OfficeDemoResults";
import { teamNotesForOffice } from "../features/office/officeNotes";
import type { DisplayStatus } from "../features/office/officeState";
import { OrderButton } from "../features/orders/OrderButton";
import { QuotationTable } from "../features/quotations/QuotationTable";
import { RecommendationList } from "../features/recommendations/RecommendationList";
import { mockIntervalFromSearch } from "./mockPace";
import { useConsultation } from "./useConsultation";

const SEARCH = new URLSearchParams(window.location.search);
const MOCK = SEARCH.has("mock");
const MOCK_INTERVAL_MS = mockIntervalFromSearch(window.location.search);

// 개발 서버에서만 여는 상태 견본 화면. 운영 빌드에서는 이 분기와 import 가 통째로 빠집니다.
const OfficeGallery = import.meta.env.DEV
  ? lazy(() => import("../features/office/OfficeGallery"))
  : null;
const SHOW_GALLERY = SEARCH.has("office-gallery");

const CONNECTION_LABEL = {
  connecting: "연결 중",
  open: "실시간 연결됨",
  reconnecting: "다시 연결 중",
  closed: "연결 끊김",
} as const;

/** Workspace 가 상단 띠에 올려 보내는 상태. key 가 지금 Workspace 와 다르면 버립니다. */
interface ShellStatus {
  key: string;
  connection: ConnectionState;
  sessionId: string | null;
  runStatus: DisplayStatus;
  records: number;
}

function connectionView(status: ShellStatus | null): { label: string; state: string } {
  if (MOCK) {
    const records = status?.records ?? 0;
    const done = status?.runStatus === "completed";
    return { label: `${done ? "시연 끝" : "시연 중"} · 기록 ${records}건`, state: "demo" };
  }
  if (!status || status.sessionId === null) return { label: "연결 준비 중", state: "connecting" };
  return { label: CONNECTION_LABEL[status.connection], state: status.connection };
}

function Workspace({
  company,
  statusKey,
  onStatus,
}: {
  company: Company | null;
  statusKey: string;
  onStatus: (status: ShellStatus) => void;
}) {
  const { office, connection, recommendations, quotation, error, submit, retry, sessionId } =
    useConsultation(company, MOCK, MOCK ? MOCK_INTERVAL_MS : undefined);
  const { chat, sendChat } = useChat(MOCK ? null : sessionId, company?.id ?? null);
  const mockTranscript = useMockTranscript(office, MOCK);
  const notes = useMemo(() => teamNotesForOffice(office), [office]);

  useEffect(() => {
    onStatus({
      key: statusKey,
      connection,
      sessionId,
      runStatus: office.runStatus,
      records: office.lastSeq,
    });
  }, [onStatus, statusKey, connection, sessionId, office.runStatus, office.lastSeq]);

  return (
    <>
      {error && <p className="error">{error}</p>}
      <div className="layout">
        <div className="consultation-workspace">
          <OfficeBoard state={office} onRetry={retry} />
          <ChatPanel
            key={sessionId ?? "preview"}
            state={MOCK ? mockTranscript.chat : chat}
            disabled={MOCK || !sessionId}
            onSend={sendChat}
            mock={MOCK}
            mockDraft={mockTranscript.draft}
            mockDraftAt={mockTranscript.draftAt}
            notes={notes}
            officeRunStatus={office.runStatus}
          />
        </div>
        <section className="workspace-results" id="results" aria-labelledby="results-title">
          <div className="results-heading">
            <h2 id="results-title">추천과 견적</h2>
            <p>
              {MOCK
                ? "시연 대본에서 받은 기록으로 채웁니다."
                : "상담 조건을 넣으면 추천 후보와 견적이 여기에 나와요."}
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
  if (OfficeGallery && SHOW_GALLERY) {
    return (
      <Suspense fallback={null}>
        <OfficeGallery />
      </Suspense>
    );
  }
  return <Shell />;
}

function Shell() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyId, setCompanyId] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [demoRun, setDemoRun] = useState(0);
  const [activeSection, setActiveSection] = useState(window.location.hash || "#workspace");
  const [status, setStatus] = useState<ShellStatus | null>(null);

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
  const workspaceKey = `${company?.id ?? "none"}:${demoRun}`;
  // 기업을 바꾸거나 다시 보기를 누른 직후에는 이전 Workspace 의 상태를 보이지 않습니다.
  const connection = connectionView(status?.key === workspaceKey ? status : null);

  return (
    <div className="app-shell">
      <aside className="app-rail" aria-label="화면 이동">
        <a className="brand" href="#workspace" aria-label="BUILDWISE 사무실로 가기">
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
            aria-current={activeSection === "#workspace" ? "location" : undefined}
          >
            <NavigationIcon kind="office" />
            <span>사무실</span>
          </a>
          <a
            href="#conversation"
            aria-current={activeSection === "#conversation" ? "location" : undefined}
          >
            <NavigationIcon kind="voice" />
            <span>상담</span>
          </a>
          <a href="#results" aria-current={activeSection === "#results" ? "location" : undefined}>
            <NavigationIcon kind="results" />
            <span>결과</span>
          </a>
        </nav>
      </aside>
      <main>
        <header className="top">
          <div className="brand-wordmark">
            <h1>BUILDWISE</h1>
            <span className="header-divider" aria-hidden="true" />
            <span className="header-context">AI 상담 직원 사무실</span>
          </div>
          <p
            className="connection"
            role="status"
            data-testid="connection"
            data-state={connection.state}
          >
            <i aria-hidden="true" />
            {connection.label}
          </p>
          {MOCK && (
            <button
              type="button"
              className="top-replay"
              onClick={() => setDemoRun((run) => run + 1)}
            >
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M4 7a6.5 6.5 0 1 1-.5 5M4 3v4h4" />
              </svg>
              시연 다시 보기
            </button>
          )}
          <span className="badge" data-testid="test-data-badge">
            <span aria-hidden="true" className="badge-dot" />
            {MOCK ? "테스트 데이터 · 시연" : "테스트 데이터"}
          </span>
          {companies.length > 0 && (
            <label className="company">
              <span className="company-label">시연용 기업 선택(로그인 아님)</span>
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
          key={workspaceKey}
          company={company}
          statusKey={workspaceKey}
          onStatus={setStatus}
        />
        <footer className="workspace-footer">가상 브랜드 · 테스트 데이터</footer>
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
