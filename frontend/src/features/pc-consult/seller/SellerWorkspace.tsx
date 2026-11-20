import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OfficeState } from "../../office/officeState";
import type { AgentEvent } from "../../../api/client";
import { selectSellerOperations } from "./operations";
import {
  CustomersPanel,
  DocumentsPanel,
  EmployeesPanel,
  IssuesPanel,
  SalesPanel,
} from "./SellerPanels";
import { useSellerDemo } from "./useSellerDemo";
import type { DemoAction, SellerMenu, SellerSession } from "./types";
import { ManagementHome, FeedbackPanel, AiTeamsPanel } from "./ManagementPanels";
import { SELLER_MENUS, SellerMenuIcon, normalizeSellerMenu } from "./SellerNavigation";
import { DEFAULT_COMPANY_POLICIES, type CompanyPolicy } from "../data/companyPolicy";
import { createCompanySource } from "../data/snapshotSource";
import type { CatalogSummary } from "../types";
import { CatalogPanel, type CatalogTab } from "./CatalogPanel";
import { CustomerPreview, type PreviewOutcome } from "./CustomerPreview";
import { PresentationBar } from "./PresentationBar";
import { Modal } from "../components/ui";
import { StartScreen } from "../components/StartScreen";
import "./seller.css";
import "./management.css";
import "./b2b.css";

const DEMO_ACTIONS: { id: DemoAction; label: string }[] = [
  { id: "consult", label: "새 상담 들어옴" },
  { id: "handoff", label: "상담 끝 → 전달" },
  { id: "claim", label: "클레임 발생" },
  { id: "abuse", label: "욕설 감지" },
  { id: "sale", label: "판매 발생" },
  { id: "auto", label: "전체 시나리오 자동 재생" },
  { id: "reset", label: "처음으로" },
];
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
  policies: providedPolicies,
  onPolicyChange,
}: {
  session: SellerSession;
  onLogout: () => void;
  embedded?: boolean;
  menu?: SellerMenu;
  onNavigate?: (menu: SellerMenu) => void;
  onNavigationState?: (info: SellerNavigationState) => void;
  policies?: Record<string, CompanyPolicy>;
  onPolicyChange?: (policy: CompanyPolicy) => void;
}) {
  const demo = useSellerDemo(session);
  const { state, office, runDemo, canManage, dispatch } = demo;
  const [localPolicies, setLocalPolicies] = useState(DEFAULT_COMPANY_POLICIES);
  const policies = providedPolicies ?? localPolicies;
  const policy = policies[session.companyCode] ?? policies["BW-1001"];
  const source = useMemo(() => createCompanySource(policy), [policy]);
  const [catalog, setCatalog] = useState<CatalogSummary | null>(null);
  const [catalogError, setCatalogError] = useState("");
  const [catalogTab, setCatalogTab] = useState<CatalogTab>("connection");
  const [demoOpen, setDemoOpen] = useState(false);
  const [issueId, setIssueId] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerSection, setCustomerSection] = useState<"customers" | "abuse">("customers");
  const [previewVisited, setPreviewVisited] = useState(false);
  const [resetCount, setResetCount] = useState(0);
  const [previewOffice, setPreviewOffice] = useState<OfficeState | null>(null);
  const [previewEvents, setPreviewEvents] = useState<AgentEvent[]>([]);
  const [outcomes, setOutcomes] = useState<PreviewOutcome[]>([]);
  const [query, setQuery] = useState("");
  const [signup, setSignup] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const shownMenu = normalizeSellerMenu(state.menu);
  const navigate = useCallback(
    (next: SellerMenu, tab?: CatalogTab) => {
      if (next === "documents") setCatalogTab("documents");
      else if (tab) setCatalogTab(tab);
      const target = normalizeSellerMenu(next);
      dispatch({ type: "NAVIGATE", menu: target });
      if (!canManage && SELLER_MENUS.find((item) => item.id === target)?.admin) {
        onNavigate?.(normalizeSellerMenu(state.menu));
        return;
      }
      if (target === "preview") setPreviewVisited(true);
      onNavigate?.(target);
      setQuery("");
    },
    [canManage, dispatch, onNavigate, state.menu],
  );
  const controller = {
    ...demo,
    navigate,
    dispatch: (event: Parameters<typeof demo.dispatch>[0]) => {
      if (!["NAVIGATE", "TOAST", "CLEAR_TOAST"].includes(event.type)) setPreviewOffice(null);
      demo.dispatch(event);
    },
    uploadDocument: (id: string) => {
      setPreviewOffice(null);
      demo.uploadDocument(id);
    },
    state: { ...state, discount: policy.maxDiscountPercent },
    savePolicy: (shippingFee: number, discount: number) => {
      demo.savePolicy(shippingFee, discount);
      savePolicy({ ...policy, maxDiscountPercent: discount, version: policy.version + 1 });
    },
  };
  useEffect(() => {
    let cancelled = false;
    setCatalog(null);
    setCatalogError("");
    source
      .getCatalogSummary?.()
      .then((value) => {
        if (!cancelled) setCatalog(value);
      })
      .catch(() => {
        if (!cancelled)
          setCatalogError(
            "상품 연결 정보를 불러오지 못했습니다. 상품·정책 연결에서 다시 시도해 주세요.",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [source]);
  useEffect(() => {
    if (menu && normalizeSellerMenu(menu) !== shownMenu) navigate(menu);
  }, [menu, shownMenu, navigate]);
  useEffect(() => {
    onNavigationState?.({ unread: state.unread, canManage, office: previewOffice ?? office });
  }, [state.unread, canManage, previewOffice, office, onNavigationState]);
  useEffect(() => {
    mainRef.current?.focus({ preventScroll: true });
  }, [shownMenu]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  const receiveOutcome = useCallback((value: PreviewOutcome) => {
    setOutcomes((old) =>
      JSON.stringify(old.at(-1)) === JSON.stringify(value) ? old : [...old.slice(-19), value],
    );
  }, []);
  const receivePreviewOffice = useCallback((next: OfficeState) => {
    setPreviewOffice(next);
    const records = [
      ...Object.values(next.teams).flatMap((team) => team.log),
      ...(next.runEvent ? [next.runEvent] : []),
    ];
    setPreviewEvents((current) => {
      const merged = new Map(current.map((event) => [`${event.session_id}:${event.seq}`, event]));
      for (const event of records) merged.set(`${event.session_id}:${event.seq}`, event);
      return [...merged.values()]
        .sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at) || a.seq - b.seq)
        .slice(-300);
    });
  }, []);
  function savePolicy(next: CompanyPolicy) {
    if (!canManage) return;
    if (onPolicyChange) onPolicyChange(next);
    else setLocalPolicies((old) => ({ ...old, [next.companyCode]: next }));
    demo.recordPolicySaved(next.version);
    setPreviewOffice(null);
  }
  const props = { controller, session };
  const active = SELLER_MENUS.find((item) => item.id === shownMenu);
  const matches = query.trim().toLowerCase();
  const customers = matches
    ? state.customers
        .filter((item) => `${item.id} ${item.name}`.toLowerCase().includes(matches))
        .slice(0, 4)
    : [];
  const consultations = matches
    ? state.consultations
        .filter((item) =>
          `${item.id} ${item.customerId} ${item.summary?.request ?? ""}`
            .toLowerCase()
            .includes(matches),
        )
        .slice(0, 4)
    : [];
  const issues = matches
    ? state.issues
        .filter((item) =>
          `${item.id} ${item.customerId} ${item.title}`.toLowerCase().includes(matches),
        )
        .slice(0, 4)
    : [];
  return (
    <div className={`seller-app b2b-app${embedded ? " seller-embedded" : ""}`}>
      <a className="seller-skip" href="#seller-main">
        본문으로 건너뛰기
      </a>
      {!embedded && (
        <aside className="seller-sidebar">
          <strong className="seller-brand">BUILDWISE</strong>
          <p>{session.companyName} · AI 상담팀 관리실</p>
          <nav aria-label="기업 메뉴">
            {SELLER_MENUS.map((item) => (
              <button
                key={item.id}
                className="seller-nav-item"
                aria-current={shownMenu === item.id ? "page" : undefined}
                onClick={() => navigate(item.id)}
              >
                <SellerMenuIcon menu={item.id} />
                <span>{item.label}</span>
                {item.admin && !canManage && <span>🔒</span>}
              </button>
            ))}
          </nav>
          <button className="seller-button seller-secondary" onClick={onLogout}>
            로그아웃
          </button>
        </aside>
      )}
      <div className="seller-workspace">
        <div className="b2b-toolbar">
          <div className="b2b-search">
            <label>
              <span className="sr-only">고객과 상담 검색</span>
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="고객 · 상담 · 인계 검색"
              />
              <kbd>Ctrl K</kbd>
            </label>
            {matches && (
              <div className="b2b-search-results" aria-label="검색 결과">
                {customers.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      setCustomerId(item.id);
                      navigate("customers");
                    }}
                  >
                    고객 · {item.name} <small>{item.id}</small>
                  </button>
                ))}
                {consultations.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      setCustomerId(item.customerId);
                      navigate("customers");
                    }}
                  >
                    상담 · {item.id}
                    <small>{item.summary?.request ?? "상담 기록"}</small>
                  </button>
                ))}
                {issues.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => {
                      setIssueId(item.id);
                      navigate("issues");
                    }}
                  >
                    인계 · {item.title}
                    <small>{item.id}</small>
                  </button>
                ))}
                {!customers.length && !issues.length && !consultations.length && (
                  <p>검색 결과가 없습니다.</p>
                )}
              </div>
            )}
          </div>
          <button className="seller-button seller-secondary" onClick={() => navigate("issues")}>
            인계 알림{" "}
            <span className="seller-count">
              {state.issues.filter((item) => item.stage !== "done").length}
            </span>
          </button>
          <button
            className="seller-button seller-secondary"
            aria-expanded={demoOpen}
            onClick={() => setDemoOpen(!demoOpen)}
          >
            시연 제어 {demoOpen ? "접기" : "열기"}
          </button>
          {canManage && (
            <PresentationBar
              key={resetCount}
              onNavigate={navigate}
              outcomes={outcomes}
              onSignup={() => setSignup(true)}
            />
          )}
        </div>
        {demoOpen && (
          <aside className="b2b-demo-panel" aria-label="시연 제어">
            <div>
              <strong>가상 이벤트 재생</strong>
              <p>어느 메뉴에서 실행해도 사무실과 운영 현황에 함께 반영됩니다.</p>
            </div>
            <div className="b2b-actions">
              {DEMO_ACTIONS.map((action) => (
                <button
                  key={action.id}
                  className="seller-button seller-secondary"
                  disabled={state.scenarioRunning && action.id !== "reset"}
                  onClick={() => {
                    setPreviewOffice(null);
                    runDemo(action.id);
                    if (action.id === "reset") {
                      setPreviewVisited(false);
                      setResetCount((value) => value + 1);
                      setPreviewEvents([]);
                      setOutcomes([]);
                      setIssueId(null);
                      setCustomerId(null);
                      setCustomerSection("customers");
                      if (canManage) {
                        const initial = DEFAULT_COMPANY_POLICIES[session.companyCode];
                        if (onPolicyChange) onPolicyChange(initial);
                        else
                          setLocalPolicies((current) => ({
                            ...current,
                            [session.companyCode]: initial,
                          }));
                      }
                    }
                  }}
                >
                  {action.id === "auto" && state.scenarioRunning
                    ? "전체 시나리오 재생 중…"
                    : action.label}
                </button>
              ))}
            </div>
          </aside>
        )}
        <section
          id="seller-main"
          className="seller-main"
          tabIndex={-1}
          ref={mainRef}
          aria-label={active?.label}
        >
          {catalogError && <p className="seller-warning">{catalogError}</p>}
          {shownMenu === "home" && (
            <ManagementHome
              controller={{
                ...controller,
                office: previewOffice ?? office,
                operations: previewOffice
                  ? selectSellerOperations(previewEvents).map((event, index) => ({
                      ...event,
                      id: index,
                      menu: "preview" as const,
                    }))
                  : controller.operations,
              }}
              session={session}
              catalog={catalog}
              onNavigate={navigate}
              onOpenIssue={(id) => {
                setIssueId(id);
                navigate("issues");
              }}
              onOpenAbuse={() => {
                setCustomerId(null);
                setCustomerSection("abuse");
                navigate("customers");
              }}
            />
          )}
          {shownMenu === "customers" && (
            <CustomersPanel
              key={`${customerId ?? "all"}:${customerSection}`}
              {...props}
              initialCustomerId={customerId}
              initialSection={customerSection}
            />
          )}
          {shownMenu === "sales" && <SalesPanel {...props} />}
          {shownMenu === "issues" && (
            <IssuesPanel key={issueId ?? "all"} {...props} initialIssueId={issueId} />
          )}
          {shownMenu === "feedback" && (
            <FeedbackPanel
              reviewSelections={demo.reviewSelections}
              onNavigate={(next) => navigate(next, next === "catalog" ? "policy" : undefined)}
            />
          )}
          {shownMenu === "catalog" && (
            <CatalogPanel
              sourceForCompany={createCompanySource}
              key={`${session.companyCode}:${catalogTab}`}
              source={source}
              policy={policy}
              policies={policies}
              onSave={savePolicy}
              onPreview={() => navigate("preview")}
              initialTab={catalogTab}
              documents={<DocumentsPanel {...props} />}
            />
          )}
          {shownMenu === "teams" && (
            <>
              <AiTeamsPanel
                office={previewOffice ?? office}
                events={previewOffice ? previewEvents : demo.events}
              />
              {canManage ? (
                <EmployeesPanel {...props} />
              ) : (
                <p className="seller-card">
                  사람 직원의 승인과 권한 변경은 관리자에게 요청해 주세요.
                </p>
              )}
            </>
          )}
          {(previewVisited || shownMenu === "preview") && (
            <div hidden={shownMenu !== "preview"}>
              <CustomerPreview
                sourceForCompany={createCompanySource}
                key={`${session.companyCode}:${resetCount}`}
                policy={policy}
                onOffice={receivePreviewOffice}
                onHandoff={(input) => {
                  setPreviewOffice(null);
                  demo.receivePreviewHandoff(input);
                }}
                onOutcome={receiveOutcome}
              />
            </div>
          )}
          <footer className="seller-footer">
            <span>
              운영 수치는 가상입니다. 경고 확인 후 선택한 이력은 ‘실제 시연’으로 구분합니다.
            </span>
            <span>고객 추천은 스냅샷 부품과 적용된 기업 정책을 사용합니다.</span>
          </footer>
        </section>
      </div>
      {signup && (
        <Modal title="기업 가입 시연" onClose={() => setSignup(false)}>
          <div className="pc-app">
            <StartScreen
              onEnter={() => setSignup(false)}
              onBusinessEnter={() => {
                setSignup(false);
                dispatch({
                  type: "TOAST",
                  message: "가입 절차를 확인했습니다. 현재 기업의 발표를 이어갑니다.",
                });
              }}
            />
          </div>
        </Modal>
      )}
      {state.toast && (
        <div className="seller-toast" key={state.toastId} role="status">
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
