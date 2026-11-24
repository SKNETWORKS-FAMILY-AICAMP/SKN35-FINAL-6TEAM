import { useEffect, useState } from "react";
import { useConsultation } from "./useConsultation";
import { IntegratedWorkspace } from "../features/pc-consult/IntegratedWorkspace";
import { StartScreen } from "../features/pc-consult/components/StartScreen";
import { SellerWorkspace } from "../features/pc-consult/seller/SellerWorkspace";
import type { AccountKind } from "../features/pc-consult/types";

export function App() {
  const [account, setAccount] = useState<AccountKind | null>(null);
  const [activeSection, setActiveSection] = useState(window.location.hash || "#workspace");
  const [attempt, setAttempt] = useState(0);
  const { session, error, connection } = useConsultation(account === "personal", attempt);
  useEffect(() => {
    const update = () => setActiveSection(window.location.hash || "#workspace");
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  function leave() {
    setAccount(null);
    window.location.hash = "login";
  }
  if (account === "business") return <SellerWorkspace onLogout={leave} />;
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
            <span>PC 상담</span>
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
          {account && (
            <>
              <p
                className="connection"
                role="status"
                data-testid="connection"
                data-state={connection}
              >
                <i aria-hidden="true" />
                {error
                  ? "연결 실패"
                  : {
                      open: "실시간 연결됨",
                      connecting: "연결 중",
                      reconnecting: "다시 연결 중",
                      closed: "연결 끊김",
                    }[connection]}
              </p>
              <div className="shell-account">
                <span>개인 상담</span>
                <button type="button" onClick={leave}>
                  상담 나가기
                </button>
              </div>
            </>
          )}
        </header>
        {!account ? (
          <section className="shell-entry pc-app" id="login" aria-label="상담 선택">
            <StartScreen
              onEnter={(kind) => {
                setAccount(kind);
                window.location.hash = "workspace";
              }}
              onBusinessEnter={() => setAccount("business")}
            />
          </section>
        ) : error ? (
          <section className="pc-empty" role="alert">
            <h2>상담을 시작하지 못했습니다.</h2>
            <p>{error}</p>
            <button
              className="pc-button pc-primary"
              onClick={() => setAttempt((value) => value + 1)}
            >
              다시 시도
            </button>
          </section>
        ) : session ? (
          <IntegratedWorkspace key={session.id} session={session} />
        ) : (
          <p className="pc-loading" role="status">
            상담 서버에 연결하고 있습니다.
          </p>
        )}
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
