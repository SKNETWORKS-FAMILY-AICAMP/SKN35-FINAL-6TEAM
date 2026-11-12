import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatPanel } from "./ChatPanel";
import type { ChatState } from "./chatState";

const state: ChatState = {
  messages: [
    {
      id: 1,
      session_id: "test-session",
      role: "user",
      content: "영상 편집용 노트북, 예산 250만 원이에요.",
      nlu: {
        confidence: 1,
        intent: "new_recommendation",
        source: "rules",
        slots: { purpose: "영상 편집", budget_max: 2500000 },
      },
      quick_replies: [],
      created_at: "2026-11-12T00:00:00Z",
    },
    {
      id: 2,
      session_id: "test-session",
      role: "assistant",
      content: "테스트 서버가 반환한 상담 답변",
      nlu: null,
      quick_replies: [{ label: "300만 원", slot: "budget_max", value: "3000000" }],
      created_at: "2026-11-12T00:00:01Z",
    },
  ],
  pending: null,
  error: null,
};

describe("상담 전사 화면", () => {
  it("기존 글 입력·선택지 testid와 서버 메시지를 유지하고 화자·시각·조건을 표시한다", () => {
    const markup = renderToStaticMarkup(
      createElement(ChatPanel, { state, disabled: false, onSend: () => {} }),
    );
    for (const id of [
      "chat-log",
      "chat-user",
      "chat-assistant",
      "chat-input",
      "chat-send",
      "chat-chip",
    ]) {
      expect(markup).toContain(`data-testid="${id}"`);
    }
    expect(markup).toContain("고객");
    expect(markup).toContain("AI 상담 직원");
    expect(markup).toContain('dateTime="2026-11-12T00:00:00Z"');
    expect(markup).toContain("테스트 서버가 반환한 상담 답변");
    expect(markup).toContain("2,500,000원");
    expect(markup).toContain("영상 편집");
    expect(markup.match(/aria-label="파악한 조건"/g)).toHaveLength(1);
  });

  it("시험 받아쓰기를 확정 메시지와 구분하고 전송하지 않는다고 표시한다", () => {
    const markup = renderToStaticMarkup(
      createElement(ChatPanel, {
        state: { messages: [], pending: null, error: null },
        disabled: true,
        mock: true,
        mockDraft: "예산 250만 원으로",
        mockDraftAt: "2026-11-12T00:00:00Z",
        onSend: () => {
          throw new Error("렌더링에서 전송하면 안 됩니다");
        },
      }),
    );
    expect(markup).toContain('data-testid="mock-transcript-draft"');
    expect(markup).toContain("시험 · 받아쓰는 중");
    expect(markup).toContain("전송하지 않습니다");
    expect(markup).not.toContain('data-testid="chat-user"');
    expect(markup).toContain("녹음 파일은 만들거나 저장하지 않습니다");
  });
});
