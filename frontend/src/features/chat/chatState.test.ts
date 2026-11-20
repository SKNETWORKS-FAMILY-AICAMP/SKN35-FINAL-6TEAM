import { describe, expect, it } from "vitest";
import type { ChatMessage, ChatTurn } from "../../api/client";
import { chatReducer, currentQuickReplies, initialChatState } from "./chatState";

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 1,
    session_id: "s",
    role: "user",
    content: "",
    quick_replies: [],
    nlu: null,
    created_at: "2026-11-12T00:00:00Z",
    ...overrides,
  };
}

function turn(userId: number, chips: ChatMessage["quick_replies"] = []): ChatTurn {
  return {
    user_message: message({ id: userId, content: "질문" }),
    assistant_message: message({
      id: userId + 1,
      role: "assistant",
      content: "답",
      quick_replies: chips,
    }),
    requirements_changed: false,
    run_id: null,
    requirement_version: 0,
  };
}

const budgetChip = { label: "300만 원", slot: "budget_max", value: "3000000" };

describe("chatReducer", () => {
  it("보내는 중 표시는 서버 답이 오면 서버 메시지로 바뀐다", () => {
    let state = chatReducer(initialChatState(), { type: "sent", text: "질문" });
    expect(state.pending).toBe("질문");
    state = chatReducer(state, { type: "received", turn: turn(1) });
    expect(state.pending).toBeNull();
    expect(state.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("같은 메시지가 다시 와도 한 번만, id 순서로 보인다", () => {
    let state = chatReducer(initialChatState(), { type: "received", turn: turn(3) });
    state = chatReducer(state, { type: "loaded", messages: [turn(1).user_message] });
    state = chatReducer(state, { type: "received", turn: turn(3) });
    expect(state.messages.map((m) => m.id)).toEqual([1, 3, 4]);
  });

  it("선택지는 마지막 상담 직원 답의 것만, 보내는 중에는 숨긴다", () => {
    let state = chatReducer(initialChatState(), { type: "received", turn: turn(1, [budgetChip]) });
    expect(currentQuickReplies(state)).toEqual([budgetChip]);
    state = chatReducer(state, { type: "sent", text: "300만 원" });
    expect(currentQuickReplies(state)).toEqual([]);
    state = chatReducer(state, { type: "received", turn: turn(3) });
    expect(currentQuickReplies(state)).toEqual([]);
  });

  it("실패하면 보내는 중을 지우고 오류를 보여 준다", () => {
    let state = chatReducer(initialChatState(), { type: "sent", text: "질문" });
    state = chatReducer(state, { type: "failed", error: "요청이 실패했습니다" });
    expect(state.pending).toBeNull();
    expect(state.error).toBe("요청이 실패했습니다");
    expect(state.messages).toEqual([]);
  });
});
