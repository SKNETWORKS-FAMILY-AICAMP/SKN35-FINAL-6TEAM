import type { components } from "../../api/pcSchema";

type Wire = components["schemas"];
export const CATEGORIES = [
  "cpu",
  "motherboard",
  "ram",
  "gpu",
  "storage",
  "cooler",
  "psu",
  "case",
] as const;
export type Category = (typeof CATEGORIES)[number];
export const CATEGORY_LABELS: Record<Category, string> = {
  cpu: "CPU",
  motherboard: "메인보드",
  ram: "RAM",
  gpu: "GPU",
  storage: "저장장치",
  cooler: "쿨러",
  psu: "파워서플라이",
  case: "케이스",
};
export type ConsultMode = "replacement" | "new";
export type AccountKind = "personal" | "business";
export type Purpose = "gaming" | "image" | "video" | "other";
export type Part = Wire["Part"];
export interface OwnedPart {
  category: Category;
  name: string;
  part: Part | null;
}
export type SelectionMap = Partial<Record<Category, Part>>;
export interface Survey {
  mode: ConsultMode;
  budget: number;
  purposes: Purpose[];
  resolution: "fhd" | "qhd" | "4k";
  frameRate: "60" | "144";
  workScale: "basic" | "large";
  problems: string[];
  problemNote: string;
  owned: Partial<Record<Category, OwnedPart>>;
}
export type CheckStatus = Wire["ValidationCheck"]["status"];
export type ValidationResult = Wire["ValidationOut"];
export type Candidate = Wire["Candidate"];
export interface CandidateRequest {
  survey: Survey;
  category: Category;
  selected: SelectionMap;
  budget: number;
  color?: string;
  note?: string;
}
export type CandidateResult = Wire["CandidatesOut"];
export type ConsultPlan = Wire["PlanOut"];
export interface Progress {
  phase: "loading" | "design" | "validation" | "ready";
  completed: number;
  total: number;
}
export type Quote = Wire["QuoteOut"];
export interface ConfirmPayload {
  acceptConditions: boolean;
  quote_id: string;
  version: number;
}
export type SaveReceipt = Wire["ReceiptOut"];
export type BudgetProposal = Wire["RebalanceOut"];
export const won = (amount: number | null | undefined) =>
  typeof amount === "number" && Number.isFinite(amount)
    ? `₩${Math.round(amount).toLocaleString("ko-KR")}`
    : "가격 미등록";

export function priceLabel(row?: {
  price_status?: string | null;
  price_basis?: string | null;
  price_checked_at?: string | null;
}) {
  if (!row) return "가격 출처 미확인";
  const status =
    row.price_status === "confirmed"
      ? "DB 확인 가격"
      : row.price_status === "test"
        ? "테스트 가격"
        : row.price_status === "unconfirmed"
          ? "미확인 가격"
          : "가격 상태 미확인";
  return [
    status,
    row.price_basis === "USD_FX_REFERENCE" ? "미 달러 환산" : "",
    row.price_checked_at ? "기록일 " + row.price_checked_at.slice(0, 10) : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
