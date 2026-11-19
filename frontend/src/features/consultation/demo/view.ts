export type PartId = string | number;
export type Mode = "upgrade" | "new";
export type Phase = "survey" | "consult" | "selection" | "quote" | "payment";

export interface DemoPart {
  id: PartId;
  category: string;
  name: string;
  price: number | null;
  price_basis?: string | null;
  price_status?: string | null;
  price_checked_at?: string | null;
  specs?: Record<string, string | number | boolean | string[]>;
}

export interface Candidate {
  id: PartId;
  name: string;
  price: number | null;
  reason?: string;
  recommended?: boolean;
  validated?: boolean;
  conditional?: boolean;
}

export interface DemoView {
  csrf: string;
  revision: number;
  phase: Phase;
  mode: Mode;
  budget: number;
  suggested_budgets?: Record<Mode, number>;
  purpose: string;
  parts: DemoPart[];
  categories: string[];
  owned: Record<string, PartId>;
  selection: Record<string, PartId>;
  category: string;
  candidates: Candidate[];
  excluded: Candidate[];
  steps: string[];
  confirmed: string[];
  lines: { id: PartId; category: string; name: string; price: number | null; quantity: number }[];
  total: number;
  remaining: number;
  checks: {
    check_type: string;
    result: string;
    reason: string;
    sources?: { title: string; url: string }[];
  }[];
  messages: {
    role: string;
    text: string;
    model?: string;
    response_id?: string;
    sources?: { title: string; url: string; text?: string }[];
  }[];
  proposal: {
    changes: { category: string; old_name: string; new_name: string; delta: number }[];
    total: number;
    description: string;
  } | null;
  error: string;
  notice: string;
  can_retry?: boolean;
  requires_qvl_consent?: boolean;
}

export const DEMO_URL = "http://127.0.0.1:8017/";
export const CATEGORY_LABEL: Record<string, string> = {
  cpu: "CPU",
  motherboard: "메인보드",
  ram: "RAM",
  gpu: "GPU",
  storage: "저장장치",
  cooler: "쿨러",
  psu: "파워",
  case: "케이스",
};

export function won(amount: number | null | undefined) {
  return typeof amount === "number" && Number.isFinite(amount)
    ? new Intl.NumberFormat("ko-KR").format(amount) + "원"
    : "가격 미등록";
}

export function priceDescription(part?: DemoPart) {
  if (!part) return "가격 출처 미확인";
  if (part.price == null) return "";
  const labels: Record<string, string> = {
    confirmed: "DB 확인 가격",
    test: "테스트 가격",
    unconfirmed: "미확인 가격",
  };
  const details = [labels[part.price_status ?? ""] ?? "가격 상태 미확인"];
  if (part.price_basis === "USD_FX_REFERENCE") details.push("미 달러 환산");
  if (part.price_checked_at) details.push("기록일 " + part.price_checked_at.slice(0, 10));
  return details.join(" · ");
}
