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
export type CoolingMode = "purchase" | "bundled" | "reuse";
export interface FanSelection {
  part: Wire["Part"];
  quantity: number;
}
export type Part = Wire["Part"] & {
  cooling?: { mode: CoolingMode; fans: FanSelection[] };
};
export function selectionLines(selected: SelectionMap): FanSelection[] {
  return [
    ...Object.values(selected).map((part) => ({ part, quantity: 1 })),
    ...(selected.cooler?.cooling?.fans ?? []),
  ];
}
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
export type ValidationCheck = Wire["ValidationCheck"];
/** 스냅샷 시연(demo)에서만 읽는 제조사 호환성 근거(part_compatibility 적재분과 같은 모양). */
export interface CompatibilityRecord {
  part_a_key: string;
  part_b_key: string;
  check_type: "CPU_SUPPORT" | "MEMORY_QVL";
  support_status: "SUPPORTED" | "CONDITIONAL";
  bios_scope: string;
  min_bios_version: string | null;
  source_publisher: string;
}
export type ValidationResult = Omit<Wire["ValidationOut"], "basis"> & { basis: DataBasis };
export type Candidate = Omit<Wire["Candidate"], "validation" | "cooling_mode"> & {
  validation: ValidationResult;
  cooling_mode?: CoolingMode;
};
export interface CandidateRequest {
  cpuBrand?: "Intel" | "AMD";
  survey: Survey;
  category: Category;
  selected: SelectionMap;
  budget: number;
  color?: string;
  note?: string;
  requestedDiscountPercent?: number;
}
export interface HandoffDecision {
  required: boolean;
  reasons: string[];
}
export interface CatalogSummary {
  categoryCounts: Record<Category, number>;
  totalParts: number;
  compatibilityCount: number;
  priceDate: string | null;
  generatedAt: string | null;
  brands: string[];
  scopedParts: number;
}
/** 실제 백엔드(api)와, 백엔드가 꺼졌을 때 쓰는 스냅샷 시연(demo) 중 어디서 온 결과인지. */
export type DataBasis = "demo" | "api";
export type CandidateResult = Omit<
  Wire["CandidatesOut"],
  "basis" | "passed" | "needsReview" | "fans"
> & {
  fans?: Part[];
  passed: Candidate[];
  needsReview: Candidate[];
  basis: DataBasis;
  handoff?: HandoffDecision;
  policyLabel?: string;
};
export type ConsultPlan = Wire["PlanOut"];
export interface Progress {
  phase: "loading" | "design" | "validation" | "ready";
  completed: number;
  total: number;
}
export type QuoteItem = Wire["QuoteItem"];
export const itemCount = (quote: { items: QuoteItem[] }) =>
  quote.items.reduce((n, i) => n + i.quantity, 0);
/** 화면에서만 쓰는 검토 표시. 공통 quote_items 계약은 바꾸지 않습니다. */
export interface PartReview {
  source_key: string;
  category: Category;
  reasons: string[];
}
export type Quote = Omit<Wire["QuoteOut"], "validation"> & {
  validation: ValidationResult;
  reviewItems?: PartReview[];
  handoff?: HandoffDecision;
  policyLabel?: string;
};
export interface ConfirmPayload {
  acceptConditions: boolean;
  quote_id: string;
  version: number;
}
export type SaveReceipt = Omit<Wire["ReceiptOut"], "quote" | "storage"> & {
  quote: Quote;
  /** session 은 상담 서버 세션, memory 는 스냅샷 시연(브라우저 메모리)입니다. */
  storage: Wire["ReceiptOut"]["storage"] | "memory";
};
export type BudgetAlternative = Omit<Wire["Alternative"], "validation"> & {
  validation: ValidationResult;
};
export type BudgetProposal = Omit<Wire["RebalanceOut"], "alternatives"> & {
  alternatives: BudgetAlternative[];
};
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
