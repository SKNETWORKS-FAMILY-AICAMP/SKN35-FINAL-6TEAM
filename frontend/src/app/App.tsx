/* TailAdmin (MIT) sidebar grouping adapted within the existing shell; pc-consult/THIRD_PARTY_NOTICES.md. */
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { ConnectionState } from "../events/eventStream";
import type { DisplayStatus, OfficeState } from "../features/office/officeState";
import { StartScreen } from "../features/pc-consult/components/StartScreen";
import { IntegratedWorkspace, LiveWorkspace } from "../features/pc-consult/IntegratedWorkspace";
import { createCompanySource } from "../features/pc-consult/data/snapshotSource";
import {
  DEFAULT_COMPANY_POLICIES,
  type CompanyPolicy,
} from "../features/pc-consult/data/companyPolicy";
import {
  SELLER_MENUS,
  SellerMenuIcon,
  normalizeSellerMenu,
} from "../features/pc-consult/seller/SellerNavigation";
import { SellerWorkspace } from "../features/pc-consult/seller/SellerWorkspace";
import type { SellerMenu, SellerSession } from "../features/pc-consult/seller/types";
import { mockIntervalFromSearch } from "./mockPace";
import { useConsultation } from "./useConsultation";

const SEARCH = new URLSearchParams(window.location.search);
/** ?demo 면 처음부터 스냅샷 시연 데이터로 상담합니다. 기본은 상담 서버(부품 DB)에 붙습니다. */
const FORCE_DEMO = SEARCH.has("demo");
const PACE_MS = mockIntervalFromSearch(window.location.search);
/** 개발 서버 전용 음성 엔진 실험 화면. 빌드 결과에는 들어가지 않습니다. */
const VOICE_LAB = import.meta.env.DEV && SEARCH.has("voice-lab");
const VoiceLab = VOICE_LAB ? lazy(() => import("../features/chat/VoiceLab")) : null;

const CONNECTION_LABEL = {
  connecting: "연결 중",
  open: "실시간 연결됨",
  reconnecting: "다시 연결 중",
  closed: "연결 끊김",
} as const;

/** 화면이 상단 띠에 올려 보내는 상태. key 가 지금 화면과 다르면 버립니다. */
interface ShellStatus {
  key: string;
  runStatus: DisplayStatus;
  records: number;
}

function demoLabel(status: ShellStatus | null) {
  const run = status?.runStatus;
  const phase =
    run === "completed"
      ? "견적 확정"
      : run === "running"
        ? "팀 작업 중"
        : run === "needs_input"
          ? "선택을 기다려요"
          : "시연 준비";
  return `${phase} · 기록 ${status?.records ?? 0}건`;
}

export function App() {
  if (VoiceLab)
    return (
      <Suspense fallback={null}>
        <VoiceLab />
      </Suspense>
    );
  return <Shell />;
}

function Shell() {
  const [demoRun, setDemoRun] = useState(0);
  const [demo, setDemo] = useState(FORCE_DEMO);
  const [attempt, setAttempt] = useState(0);
  const [activeSection, setActiveSection] = useState(window.location.hash || "#workspace");
  const [status, setStatus] = useState<ShellStatus | null>(null);
  const [account, setAccount] = useState<"personal" | "business" | null>(null);
  const [sellerSession, setSellerSession] = useState<SellerSession | null>(null);
  const [sellerMenu, setSellerMenu] = useState<SellerMenu>("home");
  const [sellerUnread, setSellerUnread] = useState<SellerMenu[]>([]);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [policies, setPolicies] = useState(DEFAULT_COMPANY_POLICIES);
  const [personalCompany, setPersonalCompany] = useState("BW-1001");
  const personalPolicy = policies[personalCompany];
  const personalSource = useMemo(() => createCompanySource(personalPolicy), [personalPolicy]);
  const saveCompanyPolicy = useCallback((policy: CompanyPolicy) => {
    setPolicies((current) => ({ ...current, [policy.companyCode]: policy }));
  }, []);
  const business = account === "business" && sellerSession !== null;
  const personalLive = account === "personal" && !demo;
  const live = useConsultation(personalLive, attempt);

  useEffect(() => {
    const updateSection = () => setActiveSection(window.location.hash || "#workspace");
    window.addEventListener("hashchange", updateSection);
    return () => window.removeEventListener("hashchange", updateSection);
  }, []);

  const workspaceKey = `${account ?? "entry"}:${demo ? "demo" : "live"}:${personalCompany}:${demoRun}`;
  const showOfficeStatus = useCallback(
    (office: OfficeState) => {
      setStatus({ key: workspaceKey, runStatus: office.runStatus, records: office.lastSeq });
    },
    [workspaceKey],
  );
  const showSellerNavigation = useCallback(
    (info: { unread: SellerMenu[]; office: OfficeState }) => {
      setSellerUnread(info.unread);
      showOfficeStatus(info.office);
    },
    [showOfficeStatus],
  );
  function logout() {
    setAccount(null);
    setSellerSession(null);
    setSellerMenu("home");
    setSellerUnread([]);
    setStatus(null);
    setDemoRun((run) => run + 1);
    setDemo(FORCE_DEMO);
    setMobileMenu(false);
    window.location.hash = "login";
  }
  // 기업을 바꾸거나 다시 보기를 누른 직후에는 이전 화면의 상태를 보이지 않습니다.
  const shown = status?.key === workspaceKey ? status : null;
  const connection: { label: string; state: ConnectionState | "demo" } =
    business || demo
      ? { label: demoLabel(shown), state: "demo" }
      : live.error
        ? { label: "연결 실패", state: "closed" }
        : !live.session
          ? { label: "연결 준비 중", state: "connecting" }
          : { label: CONNECTION_LABEL[live.connection], state: live.connection };

  // The entry is a single login surface. Workspace navigation appears only after entry.
  if (!account) {
    return (
      <main className="entry-shell">
        <section className="shell-entry pc-app" id="login" aria-label="계정 선택과 시연 로그인">
          <StartScreen
            onEnter={() => {
              setAccount("personal");
              window.location.hash = "workspace";
            }}
            onBusinessEnter={(session) => {
              setSellerSession(session);
              setPersonalCompany(session.companyCode);
              setAccount("business");
              setSellerMenu("home");
              window.location.hash = "workspace";
            }}
          />
        </section>
      </main>
    );
  }

  return (
    <div
      className={`app-shell${business ? " app-shell-business" : account === "personal" ? " app-shell-personal" : ""}`}
    >
      <aside className={`app-rail${mobileMenu ? " rail-expanded" : ""}`} aria-label="화면 이동">
        <a className="brand" href="#workspace" aria-label="BUILDWISE 사무실로 가기">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 28 28" width="28" height="28" shapeRendering="crispEdges">
              <path d="M4 4h8v8H4Zm12 0h8v8h-8ZM4 16h8v8H4Z" fill="currentColor" />
              <path d="M16 16h4v4h4v4h-8Z" fill="#c5dcae" />
            </svg>
          </span>
          {business && <span className="rail-wordmark">BUILDWISE</span>}
        </a>
        {business ? (
          <>
            <button
              className="shell-menu-toggle"
              aria-expanded={mobileMenu}
              onClick={() => setMobileMenu(!mobileMenu)}
            >
              ☰ 기업 메뉴
            </button>
            <nav className="workspace-nav business-nav" aria-label="기업 메뉴">
              <div className="shell-company-card">
                <span>{sellerSession.companyName.slice(0, 1)}</span>
                <strong>
                  {sellerSession.companyName}
                  <small>AI 상담팀 관리실</small>
                </strong>
              </div>
              {SELLER_MENUS.map(({ id, label, admin, group }, index) => (
                <div className="shell-nav-entry" key={id}>
                  {(index === 0 || SELLER_MENUS[index - 1].group !== group) && (
                    <p className="shell-nav-group">{group}</p>
                  )}
                  <button
                    type="button"
                    aria-current={sellerMenu === id ? "page" : undefined}
                    aria-label={`${label}${admin && sellerSession.role !== "admin" ? " · 관리자 전용" : ""}`}
                    onClick={() => {
                      setSellerMenu(id);
                      setMobileMenu(false);
                    }}
                  >
                    <SellerMenuIcon menu={id} />
                    <span>{label}</span>
                    {sellerSession.role !== "admin" && admin && (
                      <span aria-label="관리자 전용">🔒</span>
                    )}
                    {sellerUnread.some((item) => normalizeSellerMenu(item) === id) && (
                      <span className="shell-unread" aria-label="새 활동" />
                    )}
                  </button>
                </div>
              ))}
              <div className="shell-rail-note">
                상품 DB와 판매 정책을 연결하면
                <br />
                우리 회사의 AI 상담팀이 됩니다.<small>가상 기업 · 시연 공간</small>
              </div>
            </nav>
          </>
        ) : (
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
              <span>PC 상담</span>
            </a>
          </nav>
        )}
      </aside>
      <main>
        <header className="top">
          <div className="brand-wordmark">
            <h1>BUILDWISE</h1>
            <span className="header-divider" aria-hidden="true" />
            <span className="header-context">
              {business
                ? SELLER_MENUS.find((item) => item.id === normalizeSellerMenu(sellerMenu))?.label
                : "AI 상담 직원 사무실"}
            </span>
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
          {account && (
            <div className="shell-account">
              {business ? (
                <span className="shell-user">
                  <i className="shell-user-avatar" aria-hidden="true">
                    {sellerSession.userName.slice(0, 1)}
                  </i>
                  <span>
                    <strong>{sellerSession.userName}</strong>
                    <small>
                      {sellerSession.companyName} ·{" "}
                      {sellerSession.role === "admin" ? "관리자" : "상담원"}
                    </small>
                  </span>
                </span>
              ) : (
                <span>{demo ? "개인 상담 · 시연 데이터" : "개인 상담"}</span>
              )}
              <button type="button" onClick={logout}>
                로그아웃
              </button>
            </div>
          )}
          <span className="badge" data-testid="test-data-badge">
            <span aria-hidden="true" className="badge-dot" />
            {business
              ? "가상 기업 데이터"
              : demo
                ? "시연 데이터 · DB 미기록"
                : live.session
                  ? "부품 DB 연결"
                  : "상담 서버 연결 전"}
          </span>
          {account === "personal" && demo && (
            <label className="company">
              <span title="기업을 바꾸면 새 상담을 시작합니다.">상담 기업</span>
              <select
                aria-label="상담 기업"
                value={personalCompany}
                onChange={(event) => setPersonalCompany(event.target.value)}
              >
                {Object.values(policies).map((policy) => (
                  <option key={policy.companyCode} value={policy.companyCode}>
                    {policy.companyName} · 정책 {policy.version}
                  </option>
                ))}
              </select>
            </label>
          )}
        </header>
        {business ? (
          <SellerWorkspace
            session={sellerSession}
            onLogout={logout}
            embedded
            menu={sellerMenu}
            onNavigate={setSellerMenu}
            onNavigationState={showSellerNavigation}
            policies={policies}
            onPolicyChange={saveCompanyPolicy}
          />
        ) : demo ? (
          <IntegratedWorkspace
            key={workspaceKey}
            source={personalSource}
            policy={personalPolicy}
            sessionId={workspaceKey}
            intervalMs={PACE_MS}
            onOffice={showOfficeStatus}
          />
        ) : live.error ? (
          <section className="pc-empty" role="alert">
            <h2>상담 서버에 연결하지 못했습니다.</h2>
            <p>{live.error}</p>
            <div className="pc-actions">
              <button
                className="pc-button pc-primary"
                onClick={() => setAttempt((value) => value + 1)}
              >
                다시 시도
              </button>
              <button className="pc-button pc-secondary" onClick={() => setDemo(true)}>
                시연 데이터로 계속
              </button>
            </div>
          </section>
        ) : live.session ? (
          <LiveWorkspace key={live.session.id} session={live.session} onOffice={showOfficeStatus} />
        ) : (
          <p className="pc-loading" role="status">
            상담 서버에 연결하고 있습니다.
          </p>
        )}
        <footer className="workspace-footer">
          {business
            ? "가상 기업·고객·판매 데이터 · 시연"
            : demo
              ? "테스트 가격 · 스냅샷 시연 · DB에 기록되지 않습니다"
              : "부품 DB 기록 가격(달러 환산 테스트 가격) · 견적은 상담 세션에만 보관"}
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
