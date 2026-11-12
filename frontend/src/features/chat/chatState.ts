/**
 * 채팅 상담 화면 상태. 서버가 저장한 메시지만 대화로 보여 줍니다 — 상담 직원의 답을 화면에서 지어내지 않습니다.
 *
 * 규칙
 * - 메시지는 서버 id 순서로 한 번씩만 보입니다(같은 메시지가 다시 와도 중복 없음).
 * - 보내는 중인 글은 '보내는 중'으로만 표시하고, 서버 답이 오면 서버 메시지로 바꿉니다.
 * - 선택지(칩)는 마지막 메시지가 상담 직원의 답일 때 그 답의 것만 보입니다.
 */
import type { ChatMessage, ChatTurn, QuickReply } from "../../api/client";

export interface ChatState {
  messages: ChatMessage[];
  pending: string | null;
  error: string | null;
}

export type ChatAction =
  | { type: "loaded"; messages: ChatMessage[] }
  | { type: "sent"; text: string }
  | { type: "received"; turn: ChatTurn }
  | { type: "failed"; error: string };

export function initialChatState(): ChatState {
  return { messages: [], pending: null, error: null };
}

function merge(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "loaded":
      return { ...state, messages: merge(state.messages, action.messages) };
    case "sent":
      return { ...state, pending: action.text, error: null };
    case "received":
      return {
        messages: merge(state.messages, [action.turn.user_message, action.turn.assistant_message]),
        pending: null,
        error: null,
      };
    case "failed":
      return { ...state, pending: null, error: action.error };
  }
}

export function currentQuickReplies(state: ChatState): QuickReply[] {
  if (state.pending !== null) return [];
  const last = state.messages.at(-1);
  return last && last.role === "assistant" ? last.quick_replies : [];
}
