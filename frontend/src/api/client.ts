/**
 * API 클라이언트. 타입은 schema.d.ts(자동 생성)에서 옵니다 — 필드 이름을 손으로 쓰지 않습니다.
 * schema.d.ts 를 직접 고치지 말고, 백엔드 계약을 바꾼 뒤 `scripts/gen-contracts` 로 다시 만듭니다.
 */
import createClient from "openapi-fetch";
import type { components, paths } from "./schema";

export type Schemas = components["schemas"];
export type Company = Schemas["CompanyOut"];
export type Session = Schemas["SessionOut"];
export type RequirementsIn = Schemas["RequirementsIn"];
export type Recommendation = Schemas["RecommendationOut"];
export type Quotation = Schemas["QuotationOut"];
export type Order = Schemas["OrderOut"];
export type AgentEvent = Schemas["AgentEventOut"];
export type Team = Schemas["Team"];
export type WorkStatus = Schemas["WorkStatus"];
export type EventError = Schemas["EventError"];

// 같은 주소의 /api 로 보내면 Vite 개발 서버가 백엔드로 넘겨 줍니다(vite.config.ts 의 proxy).
export const api = createClient<paths>({ baseUrl: "" });

export function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "detail" in error) {
    const detail = (error as { detail: unknown }).detail;
    return typeof detail === "string" ? detail : JSON.stringify(detail);
  }
  return "요청이 실패했습니다. 백엔드가 켜져 있는지 확인하세요.";
}

// Display models shared by the transcript, voice controller and server-message adapter.
export interface QuickReplyIn {
  slot: string;
  value: string;
}
export interface QuickReply {
  label: string;
  slot?: string | null;
  value?: string | null;
}
export interface ChatMessage {
  id: number;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  quick_replies: QuickReply[];
  nlu: {
    intent: string;
    source: string;
    confidence: number;
    slots: Record<string, number | string | string[]>;
  } | null;
  sources?: { title: string; url?: string | null; text?: string | null }[];
}
export interface ChatTurn {
  user_message: ChatMessage;
  assistant_message: ChatMessage;
  requirements_changed: boolean;
  run_id: string | null;
  requirement_version: number;
}
