import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TeamNote } from "../office/officeNotes";
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

  it("서버 답변의 근거 주소와 제목을 표시한다", () => {
    const message = {
      ...state.messages[1],
      sources: [{ title: "제조사 지원 문서", url: "https://example.org/support" }],
    };
    const markup = renderToStaticMarkup(
      createElement(ChatPanel, {
        state: { ...state, messages: [message] },
        disabled: false,
        onSend: () => {},
      }),
    );
    expect(markup).toContain('href="https://example.org/support"');
    expect(markup).toContain("제조사 지원 문서");
  });

  it("팀 작업 기록은 chat-team-note 한 줄로 끼우고 상담 직원 답 수는 바꾸지 않는다", () => {
    const notes: TeamNote[] = [
      {
        seq: 3,
        team: "validation",
        type: "task.completed",
        status: "completed",
        message: "노트북 B: 부적합 — 메모리 16GB (조건 32GB 이상)",
        occurredAt: "2026-11-12T00:00:00.500Z",
      },
      {
        seq: 4,
        team: "quotation",
        type: "task.started",
        status: "running",
        message: "참고 견적 작성 시작",
        occurredAt: "2026-11-12T00:00:00.700Z",
      },
    ];
    const markup = renderToStaticMarkup(
      createElement(ChatPanel, { state, disabled: false, onSend: () => {}, notes }),
    );
    expect(markup.match(/data-testid="chat-team-note"/g)).toHaveLength(2);
    expect(markup.match(/data-testid="chat-assistant"/g)).toHaveLength(1);
    expect(markup.match(/data-testid="chat-user"/g)).toHaveLength(1);
    expect(markup.match(/팀 작업 기록/g)).toHaveLength(1);
    const noteRows = markup.match(/<li class="transcript-note"[\s\S]*?<\/li>/g) ?? [];
    expect(noteRows).toHaveLength(2);
    expect(noteRows[0]).toContain("검증팀");
    expect(noteRows[0]).toContain("노트북 B: 부적합 — 메모리 16GB (조건 32GB 이상)");
    expect(noteRows[1]).toContain("견적·주문팀");
    for (const row of noteRows) {
      expect(row).not.toContain("AI 상담 직원");
      expect(row).not.toContain("chat-assistant");
    }
    // 시각 순: 고객(00:00:00) → 팀 기록(00:00:00.5, 00:00:00.7) → 상담 직원 답(00:00:01)
    const order = ["chat-user", "chat-team-note", "chat-assistant"].map((id) =>
      markup.indexOf(`data-testid="${id}"`),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("실서버 화면은 팀 기록이 없으면 기존 대화 흐름 그대로이고 시연 문구를 싣지 않는다", () => {
    const markup = renderToStaticMarkup(
      createElement(ChatPanel, { state, disabled: false, onSend: () => {} }),
    );
    expect(markup).not.toContain('data-testid="chat-team-note"');
    expect(markup.match(/data-testid="chat-assistant"/g)).toHaveLength(1);
    expect(markup).toContain('id="conversation"');
    expect(markup).toContain('data-testid="voice-status"');
    expect(markup).toContain('data-testid="voice-mic"');
    expect(markup).toContain('data-testid="voice-reply"');
    expect(markup).toContain('data-variant="primary"');
    expect(markup).toContain('placeholder="예: 노트북 추천, 예산 300만 원"');
    expect(markup).toContain("음성 상담 대기");
    expect(markup).toContain("녹음 파일은 만들거나 저장하지 않습니다");
    expect(markup).not.toContain("시연 대본입니다");
  });

  it("음성이 대기일 때 오피스 이벤트의 실행 상태를 표시한다", () => {
    const render = (props: Partial<Parameters<typeof ChatPanel>[0]>) =>
      renderToStaticMarkup(
        createElement(ChatPanel, {
          state: { messages: [], pending: null, error: null },
          disabled: true,
          onSend: () => {},
          ...props,
        }),
      );
    const working = render({ officeRunStatus: "running" });
    expect(working).toContain('data-display="working"');
    expect(working).toContain("팀이 작업 중이에요");
    expect(working).not.toContain("음성 상담 대기");
    expect(render({ officeRunStatus: "pending" })).toContain("팀이 작업 중이에요");
    expect(render({ officeRunStatus: "needs_input" })).toContain("고객 확인을 기다려요");
    const done = render({ officeRunStatus: "completed" });
    expect(done).toContain('data-display="done"');
    expect(done).toContain("답변 준비됨");
    expect(done).toContain('data-phase="idle"');
    expect(done).toContain('data-variant="primary"');
    expect(done).toContain('placeholder="예: 노트북 추천, 예산 300만 원"');
  });

  it("영문 장식 라벨과 내부 용어를 화면 글자에 싣지 않는다", () => {
    for (const disabled of [true, false]) {
      const markup = renderToStaticMarkup(
        createElement(ChatPanel, { state, disabled, onSend: () => {} }),
      );
      const text = markup.replace(/<[^>]+>/g, " ");
      for (const word of ["VOICE CONSOLE", "DEMO", "LIVE", "Mock", "전사", "시험 대본", "데모"]) {
        expect(text).not.toContain(word);
      }
      expect(text).toContain("음성 상담");
      expect(text).toContain("대화 기록");
    }
  });
});
