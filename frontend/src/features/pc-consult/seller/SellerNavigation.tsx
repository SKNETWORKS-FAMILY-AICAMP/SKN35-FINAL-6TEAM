import type { SellerMenu } from "./types";

/** TailAdmin sidebar grouping adapted to the existing React shell. See ../THIRD_PARTY_NOTICES.md. */
// eslint-disable-next-line react-refresh/only-export-components -- Static navigation metadata intentionally shares this registry with its stateless icon component.
export const SELLER_MENUS = [
  { id: "home", label: "기업 홈", group: "업무 공간", admin: false },
  { id: "issues", label: "상담 · 이슈", group: "업무 공간", admin: false },
  { id: "customers", label: "고객 정보", group: "업무 공간", admin: false },
  { id: "preview", label: "고객 화면 미리보기", group: "업무 공간", admin: false },
  { id: "feedback", label: "고객 피드백", group: "인사이트", admin: false },
  { id: "sales", label: "판매 통계", group: "인사이트", admin: true },
  { id: "catalog", label: "상품 · 정책", group: "기업 설정", admin: true },
  { id: "teams", label: "AI 직원 · 사람 직원", group: "기업 설정", admin: false },
] as const satisfies readonly {
  id: SellerMenu;
  label: string;
  group: string;
  admin: boolean;
}[];

/** Old entry points keep working without adding duplicate menus. */
// eslint-disable-next-line react-refresh/only-export-components -- Pure normalization of the same static navigation registry; no component state is exported.
export function normalizeSellerMenu(menu: SellerMenu): SellerMenu {
  if (menu === "office") return "home";
  if (menu === "documents") return "catalog";
  if (menu === "employees") return "teams";
  return menu;
}

export function SellerMenuIcon({ menu, className }: { menu: SellerMenu; className?: string }) {
  const normalized = normalizeSellerMenu(menu);
  return (
    <svg
      className={className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {normalized === "home" && <path d="m3 10 9-7 9 7v10h-6v-7H9v7H3Z" />}
      {normalized === "issues" && <path d="M4 4h16v12H9l-5 4Zm4 4h8m-8 4h5" />}
      {normalized === "customers" && (
        <>
          <circle cx="9" cy="8" r="3" />
          <path d="M3 20v-2a6 6 0 0 1 12 0v2m2-15a3 3 0 0 1 0 6m1 3a5 5 0 0 1 3 5v1" />
        </>
      )}
      {normalized === "preview" && (
        <>
          <rect x="3" y="4" width="18" height="13" rx="2" />
          <path d="M8 21h8m-4-4v4m-3-10 2 2 4-4" />
        </>
      )}
      {normalized === "feedback" && <path d="M4 4h16v13H9l-5 4Zm4 4h8m-8 4h5" />}
      {normalized === "sales" && <path d="M4 3v17h17M8 15v-5m5 5V6m5 9v-8" />}
      {normalized === "catalog" && (
        <>
          <path d="m3 7 9-4 9 4-9 4Zm0 0v10l9 4 9-4V7m-9 4v10M7.5 5l9 4v5" />
        </>
      )}
      {normalized === "teams" && (
        <>
          <rect x="4" y="6" width="16" height="14" rx="3" />
          <path d="M12 3v3M1 11h3m16 0h3M8 16h8" />
          <circle cx="8" cy="11" r="1" />
          <circle cx="16" cy="11" r="1" />
        </>
      )}
    </svg>
  );
}
