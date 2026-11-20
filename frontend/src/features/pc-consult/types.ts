/** Local presentation types; these are proposals, not changes to the shared API contract. */
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
export interface Part {
  part_id: number;
  source_key: string;
  category: Category;
  brand: string;
  name: string;
  specs: Record<string, unknown>;
  current_price: number | null;
  currency: string;
  price_status: string;
  data_status: string;
  price_checked_at: string | null;
  power_draw_w: number | null;
  power_status: string | null;
  image_url: string | null;
}
export interface CompatibilityRecord {
  part_a_key: string;
  part_b_key: string;
  check_type: "CPU_SUPPORT" | "MEMORY_QVL";
  support_status: "SUPPORTED" | "CONDITIONAL";
  bios_scope: string;
  min_bios_version: string | null;
  source_publisher: string;
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
export type CheckStatus = "PASS" | "CONDITIONAL" | "UNKNOWN" | "FAIL" | "PENDING";
export interface ValidationCheck {
  code: string;
  status: CheckStatus;
  message: string;
  source?: string;
}
export interface ValidationResult {
  status: Exclude<CheckStatus, "PENDING">;
  checks: ValidationCheck[];
  basis: "demo" | "api";
}
export interface Candidate {
  part: Part;
  validation: ValidationResult;
  recommended: boolean;
  reason: string;
}
export interface CandidateRequest {
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
export interface CandidateResult {
  passed: Candidate[];
  needsReview: Candidate[];
  rejectedCount: number;
  missingColorCount: number;
  sortLabel: string;
  criteria: string[];
  basis: "demo" | "api";
  handoff?: HandoffDecision;
  policyLabel?: string;
}
export interface ConsultPlan {
  steps: Category[];
  reasons: Partial<Record<Category, string>>;
  allocations: Record<Category, number>;
  criteria: string[];
}
export interface Progress {
  phase: "loading" | "design" | "validation" | "ready";
  completed: number;
  total: number;
}
export interface QuoteItem {
  source_key: string;
  category: Category;
  part_name_snapshot: string;
  unit_price: number;
  quantity: number;
  price_checked_at: string | null;
}
/** Local quote review metadata; it does not alter the shared quote_items contract. */
export interface PartReview {
  source_key: string;
  category: Category;
  reasons: string[];
}
export interface Quote {
  consultation_id: string;
  version: number;
  status: "DRAFT" | "CONFIRMED";
  currency: "KRW";
  total_amount: number;
  created_at: string;
  items: QuoteItem[];
  validation: ValidationResult;
  reviewItems?: PartReview[];
  handoff?: HandoffDecision;
  policyLabel?: string;
}
export interface ConfirmPayload {
  quotes: {
    consultation_id: string;
    version: number;
    status: "CONFIRMED";
    total_amount: number;
    currency: "KRW";
  };
  quote_items: QuoteItem[];
}
export interface SaveReceipt {
  quote: Quote;
  storage: "memory" | "database";
  message: string;
}
export interface BudgetAlternative {
  category: Category;
  before: Part;
  after: Part;
  validation: ValidationResult;
}
export interface BudgetProposal {
  alternatives: BudgetAlternative[];
  beforeTotal: number;
  afterTotal: number;
  allocations: Record<Category, number>;
  feasible: boolean;
  explanation: string;
}
export const won = (amount: number) => `₩${Math.round(amount).toLocaleString("ko-KR")}`;
