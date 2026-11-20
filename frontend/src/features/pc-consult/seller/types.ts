import type { ReviewSelection } from "../reviewSelectionStore";

export type SellerRole = "admin" | "agent";
export type SellerMenu =
  | "home"
  | "customers"
  | "sales"
  | "issues"
  | "documents"
  | "employees"
  | "office"
  | "catalog"
  | "feedback"
  | "preview"
  | "teams";
export interface SellerSession {
  companyCode: string;
  companyName: string;
  userName: string;
  role: SellerRole;
}
export interface Customer {
  id: string;
  name: string;
  kind: "개인" | "학생" | "스타트업" | "연구실";
  lastConsulted: string;
  blocked: boolean;
  blockReason: string;
  blockedBy: string;
  blockedAt: string;
}
export interface SellerQuote {
  id: string;
  customerId: string;
  date: string;
  total: number;
  items: { name: string; price: number; quantity: number }[];
}
export interface ChatLine {
  speaker: "고객" | "상담 에이전트";
  text: string;
}
export interface SellerConsultation {
  id: string;
  customerId: string;
  date: string;
  lines: ChatLine[];
  summary: { request: string; recommendation: string; attention: string } | null;
}
export type IssueStage = "received" | "classified" | "working" | "done";
export interface SellerIssue {
  id: string;
  customerId: string;
  kind: "이슈" | "클레임" | "오류";
  title: string;
  stage: IssueStage;
  assignee: string;
  summary: string;
  suggestion: string;
  reasons?: string[];
  lines?: { speaker: string; text: string; occurredAt?: string }[];
  teamNotes?: { team: string; message: string; occurredAt: string }[];
  consultationId?: string;
  dataOrigin?: "browser-selection" | "browser-preview";
  reviewSelections?: ReviewSelection[];
}
export interface PreviewHandoffInput {
  id: string;
  reasons: string[];
  messages: { speaker: string; text: string; occurredAt?: string }[];
  teamNotes: { team: string; message: string; occurredAt: string }[];
  dataOrigin?: "browser-selection" | "browser-preview";
  reviewSelections?: ReviewSelection[];
}
export interface Employee {
  id: string;
  name: string;
  role: SellerRole;
  status: "pending" | "active" | "inactive";
}
export interface SellerDocument {
  id: string;
  title: string;
  kind: string;
  updatedAt: string;
  reflected: boolean;
}
export interface AbuseAlert {
  id: string;
  customerId: string;
  text: string;
  time: string;
  ignored: boolean;
}
export interface SalesPart {
  id: string;
  name: string;
  category: string;
  price: number;
  sales: number;
  demand: number;
}
export interface Activity {
  id: number;
  text: string;
  time: string;
  menu: SellerMenu;
}
export interface OfficeState {
  phase:
    "idle" | "talking" | "handoff" | "summary" | "classifying" | "classified" | "working" | "done";
  consultationId: string;
  customerId: string;
  bubble: string;
  issueId: string | null;
  log: string[];
}
export interface SellerState {
  customers: Customer[];
  quotes: SellerQuote[];
  consultations: SellerConsultation[];
  issues: SellerIssue[];
  employees: Employee[];
  documents: SellerDocument[];
  alerts: AbuseAlert[];
  parts: SalesPart[];
  feed: Activity[];
  todayConsultations: number;
  todaySales: number;
  activeConsultations: number;
  waitingConsultations: number;
  completedConsultations: number;
  office: OfficeState;
  shippingFee: number;
  discount: number;
  unread: SellerMenu[];
  menu: SellerMenu;
  toast: string;
  toastId: number;
  uploadProgress: number | null;
  scenarioRunning: boolean;
  /** Latest policy receipt only; policy values are owned by App. */
  policyVersion: number;
}
export type DemoAction = "consult" | "handoff" | "claim" | "abuse" | "sale" | "auto" | "reset";
