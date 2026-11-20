import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { OfficeState } from "../../office/officeState";
import {
  CustomersPanel,
  DocumentsPanel,
  EmployeesPanel,
  HomePanel,
  IssuesPanel,
  OfficePanel,
  SalesPanel,
} from "./SellerPanels";
import { useSellerDemo } from "./useSellerDemo";
import type { DemoAction, SellerMenu, SellerSession } from "./types";
import "./seller.css";

const MENUS: { id: SellerMenu; label: string; admin?: boolean; icon: ReactNode }[] = [
  {
    id: "home",
    label: "홈",
    icon: (
      <>
        <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" />
      </>
    ),
  },
  {
    id: "customers",
    label: "고객 정보",
    icon: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 20v-3a6 6 0 0 1 12 0v3m1-15a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5v1" />
      </>
    ),
  },
  {
    id: "sales",
    label: "판매 통계",
    admin: true,
    icon: (
      <>
        <path d="M4 3v17h17M8 15v-5m5 5V6m5 9v-8" />
      </>
    ),
  },
  {
    id: "issues",
    label: "상담 · 이슈 현황",
    icon: (
      <>
        <path d="M4 4h16v12H9l-5 4Z" />
        <path d="M8 8h8m-8 4h5" />
      </>
    ),
  },
  {
    id: "documents",
    label: "문서 · 정책 관리",
    admin: true,
    icon: (
      <>
        <path d="M5 3h9l5 5v13H5Z" />
        <path d="M14 3v6h5M8 13h8m-8 4h5" />
      </>
    ),
  },
  {
    id: "employees",
    label: "직원 관리",
    admin: true,
    icon: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M8 5V3h8v2m-13 7h18M10 10h4v4h-4Z" />
      </>
    ),
  },
  {
    id: "office",
    label: "2D 오피스",
    icon: (
      <>
        <path d="M3 20h18M5 20V4h9v16m0-12h5v12M8 8h3m-3 4h3m-3 4h3m5-4h1m-1 4h1" />
      </>
    ),
  },
];
const DEMO_ACTIONS: { id: DemoAction; label: string; icon: string }[] = [
  { id: "consult", label: "새 상담 들어옴", icon: "+" },
  { id: "handoff", label: "상담 끝 → 전달", icon: "→" },
  { id: "claim", label: "클레임 발생", icon: "!" },
  { id: "abuse", label: "욕설 감지", icon: "◇" },
  { id: "sale", label: "판매 발생", icon: "₩" },
  { id: "auto", label: "전체 시나리오 자동 재생", icon: "▷" },
  { id: "reset", label: "처음으로", icon: "↺" },
];

function LockIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      <rect x="4" y="9" width="12" height="9" rx="2" />
      <path d="M6 9V6a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

export interface SellerNavigationState {
  unread: SellerMenu[];
  canManage: boolean;
  office: OfficeState;
}

export function SellerWorkspace({
  session,
  onLogout,
  embedded = false,
  menu,
  onNavigate,
  onNavigationState,
}: {
  session: SellerSession;
  onLogout: () => void;
  embedded?: boolean;
  menu?: SellerMenu;
  onNavigate?: (menu: SellerMenu) => void;
  onNavigationState?: (info: SellerNavigationState) => void;
}) {
  const demo = useSellerDemo(session);
  const { state, office, runDemo, canManage, dispatch } = demo;
  const navigate = useCallback(
    (next: SellerMenu) => {
      dispatch({ type: "NAVIGATE", menu: next });
      if (canManage || !MENUS.find((item) => item.id === next)?.admin) onNavigate?.(next);
    },
    [canManage, dispatch, onNavigate],
  );
  const controller = { ...demo, navigate };
  const [demoOpen, setDemoOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [issueId, setIssueId] = useState<string | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const lastMenu = useRef(state.menu);
  useEffect(() => {
    if (!menu || menu === state.menu) return;
    dispatch({ type: "NAVIGATE", menu });
    if (!canManage && MENUS.find((item) => item.id === menu)?.admin) onNavigate?.(state.menu);
  }, [menu, state.menu, canManage, dispatch, onNavigate]);
  useEffect(() => {
    onNavigationState?.({ unread: state.unread, canManage, office });
  }, [state.unread, canManage, office, onNavigationState]);
  useEffect(() => {
    if (embedded && lastMenu.current !== state.menu)
      mainRef.current?.scrollIntoView({ block: "start" });
    mainRef.current?.focus({ preventScroll: true });
    if (!embedded) window.scrollTo({ top: 0, behavior: "instant" });
    lastMenu.current = state.menu;
  }, [state.menu, embedded]);
  const active = MENUS.find((menu) => menu.id === state.menu)!;
  const props = { controller, session };
  const Content = embedded ? "section" : "main";
  return (
    <div className={`seller-app${embedded ? " seller-embedded" : ""}`}>
      <a className="seller-skip" href="#seller-main">
        본문으로 건너뛰기
      </a>
      {!embedded && (
        <aside className={`seller-sidebar${mobileNav ? " seller-nav-open" : ""}`}>
          <a className="seller-brand" href="?pc-consult=1" aria-label="빌드와이즈 시작 화면">
            <span className="seller-brand-symbol">
              B<span>↗</span>
            </span>
            <span>
              BUILDWISE<small>판매자 워크스페이스</small>
            </span>
          </a>
          <div className="seller-company-card">
            <span>{session.companyName.slice(0, 1)}</span>
            <div>
              <strong>{session.companyName}</strong>
              <small>기업용 시연 공간</small>
            </div>
            <i aria-hidden="true">⌄</i>
          </div>
          <p className="seller-nav-label">워크스페이스</p>
          <nav aria-label="판매자 메뉴">
            {MENUS.map((menu) => {
              const locked = Boolean(menu.admin && !canManage);
              return (
                <button
                  type="button"
                  key={menu.id}
                  className={`seller-nav-item${state.menu === menu.id ? " seller-active" : ""}${locked ? " seller-locked" : ""}`}
                  aria-current={state.menu === menu.id ? "page" : undefined}
                  aria-label={`${menu.label}${locked ? " · 관리자 전용" : ""}`}
                  onClick={() => {
                    navigate(menu.id);
                    setMobileNav(false);
                  }}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    {menu.icon}
                  </svg>
                  <span>{menu.label}</span>
                  {locked ? (
                    <LockIcon />
                  ) : state.unread.includes(menu.id) ? (
                    <span className="seller-unread" aria-label="새로운 활동" />
                  ) : null}
                </button>
              );
            })}
          </nav>
          <div className="seller-sidebar-bottom">
            <div className="seller-demo-seal">
              <span aria-hidden="true">✦</span>
              <strong>지금은 시연 중이에요.</strong>
              <p>모든 고객과 판매 정보는 가상 데이터예요. 새로고침하면 초기화됩니다.</p>
            </div>
            <span className="seller-sidebar-copyright">BUILDWISE · 함께 일하는 AI</span>
          </div>
        </aside>
      )}
      <div className="seller-workspace">
        {!embedded && (
          <header className="seller-topbar">
            <div className="seller-breadcrumb">
              <button
                className="seller-mobile-menu"
                aria-label="메뉴 열기"
                aria-expanded={mobileNav}
                onClick={() => setMobileNav(!mobileNav)}
              >
                ☰
              </button>
              <span>{session.companyName}</span>
              <span aria-hidden="true">/</span>
              <strong>{active.label}</strong>
            </div>
            <div className="seller-topbar-right">
              <span className="seller-live-tag">
                <i />
                시연 모드
              </span>
              <div className="seller-user">
                <span className="seller-avatar seller-avatar-small">
                  {session.userName.slice(0, 1)}
                </span>
                <span>
                  <strong>{session.userName}</strong>
                  <small>{session.role === "admin" ? "관리자" : "상담원"}</small>
                </span>
              </div>
              <button className="seller-logout" onClick={onLogout}>
                로그아웃
              </button>
            </div>
          </header>
        )}
        <Content
          id="seller-main"
          className="seller-main"
          key={state.menu}
          tabIndex={-1}
          ref={mainRef}
        >
          {state.menu === "home" && <HomePanel {...props} />}
          {state.menu === "customers" && <CustomersPanel {...props} />}
          {state.menu === "sales" && <SalesPanel {...props} />}
          {state.menu === "issues" && <IssuesPanel {...props} initialIssueId={issueId} />}
          {state.menu === "documents" && <DocumentsPanel {...props} />}
          {state.menu === "employees" && <EmployeesPanel {...props} />}
          {state.menu === "office" && (
            <OfficePanel
              {...props}
              onOpenIssue={(id) => {
                setIssueId(id);
                navigate("issues");
              }}
            />
          )}
          <footer className="seller-footer">
            <span>모든 수치는 가상 데이터입니다.</span>
            <span>실제 인증 · DB 저장 · 외부 결제 연결 없음</span>
          </footer>
        </Content>
      </div>
      <aside
        className={`seller-demo-controls${demoOpen ? " seller-demo-expanded" : ""}`}
        aria-label="시연 제어"
      >
        <button
          className="seller-demo-toggle"
          onClick={() => setDemoOpen(!demoOpen)}
          aria-expanded={demoOpen}
        >
          <span>
            <span aria-hidden="true">▷</span> 시연 제어
          </span>
          <span>{demoOpen ? "접기 −" : "펼치기 +"}</span>
        </button>
        {demoOpen && (
          <div className="seller-demo-buttons">
            <p>어느 화면에서든 같은 시연 상태에 반영돼요.</p>
            {DEMO_ACTIONS.map((action) => (
              <button
                key={action.id}
                className={
                  action.id === "auto"
                    ? "seller-demo-auto"
                    : action.id === "reset"
                      ? "seller-demo-reset"
                      : ""
                }
                disabled={state.scenarioRunning && action.id !== "reset"}
                onClick={() => runDemo(action.id)}
              >
                <span aria-hidden="true">{action.icon}</span>
                {action.id === "auto" && state.scenarioRunning
                  ? "전체 시나리오 재생 중…"
                  : action.label}
              </button>
            ))}
            <small>처음으로를 누르면 시연 상태가 초기화돼요.</small>
          </div>
        )}
      </aside>
      {state.toast && (
        <div className="seller-toast" key={state.toastId} role="status">
          <span aria-hidden="true">✓</span>
          <p>{state.toast}</p>
          <button
            aria-label="알림 닫기"
            onClick={() => dispatch({ type: "CLEAR_TOAST", toastId: state.toastId })}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
