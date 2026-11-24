import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SellerMenu } from "./types";
import { SellerPanels } from "./SellerPanels";
import "./seller.css";
const MENUS: { id: SellerMenu; label: string; icon: ReactNode }[] = [
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

export function SellerWorkspace({ onLogout }: { onLogout: () => void }) {
  const [menu, setMenu] = useState<SellerMenu>("home");
  const [mobileNav, setMobileNav] = useState(false);
  const main = useRef<HTMLElement>(null);
  useEffect(() => {
    main.current?.focus({ preventScroll: true });
  }, [menu]);
  return (
    <div className="seller-app">
      <a className="seller-skip" href="#seller-main">
        본문으로 건너뛰기
      </a>
      <aside className={`seller-sidebar${mobileNav ? " seller-nav-open" : ""}`}>
        <a
          className="seller-brand"
          href="/"
          onClick={(event) => {
            event.preventDefault();
            onLogout();
          }}
        >
          <span className="seller-brand-symbol">
            B<span>↗</span>
          </span>
          <span>
            BUILDWISE<small>판매자 워크스페이스</small>
          </span>
        </a>
        <div className="seller-company-card">
          <span>▦</span>
          <div>
            <strong>기업 계정</strong>
            <small>미연결</small>
          </div>
        </div>
        <p className="seller-nav-label">워크스페이스</p>
        <nav aria-label="판매자 메뉴">
          {MENUS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`seller-nav-item${menu === item.id ? " seller-active" : ""}`}
              aria-current={menu === item.id ? "page" : undefined}
              onClick={() => {
                setMenu(item.id);
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
                {item.icon}
              </svg>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </aside>
      <div className="seller-workspace">
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
            <span>판매자 워크스페이스</span>
            <span aria-hidden="true">/</span>
            <strong>{MENUS.find((item) => item.id === menu)?.label}</strong>
          </div>
          <button className="seller-logout" onClick={onLogout}>
            시작 화면
          </button>
        </header>
        <main id="seller-main" className="seller-main" ref={main} tabIndex={-1}>
          <SellerPanels menu={menu} />
        </main>
      </div>
    </div>
  );
}
