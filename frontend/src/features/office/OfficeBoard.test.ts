import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "../../api/client";
import { buildMockEvents } from "../../events/mockEventStream";
import { OfficeBoard } from "./OfficeBoard";
import { initialOfficeState, officeReducer, TEAMS, type OfficeState } from "./officeState";

function render(state: OfficeState, onRetry?: () => void) {
  return renderToStaticMarkup(createElement(OfficeBoard, { state, onRetry }));
}

function summary(markup: string) {
  const match = markup.match(/<p class="office-summary-copy"[^>]*>(.*?)<\/p>/s);
  if (!match) throw new Error("업무 현황 요약을 찾을 수 없습니다.");
  return match[1];
}

function withRunEvent(overrides: Partial<AgentEvent>) {
  const events = buildMockEvents();
  const state = events.slice(0, 7).reduce(officeReducer, initialOfficeState());
  return officeReducer(state, {
    ...events[7],
    team: null,
    type: "run.failed",
    status: "failed",
    message: "테스트 실행 중단",
    ...overrides,
  });
}

describe("OfficeBoard", () => {
  it("기존 실행 상태와 네 팀의 testid를 유지한다", () => {
    const markup = render(initialOfficeState());
    expect(markup).toContain('data-testid="run-status"');
    for (const team of TEAMS) {
      expect(markup).toContain(`data-testid="desk-${team}"`);
    }
    expect(summary(markup)).toContain("요청을 기다리고");
    expect(markup).toContain('aria-label="네 팀의 픽셀 사무실"');
  });

  it("검증 작업 하나가 완료되어도 남은 작업이 있으면 진행 중으로 표시한다", () => {
    const state = buildMockEvents().slice(0, 9).reduce(officeReducer, initialOfficeState());
    const markup = render(state);
    const desk = markup.match(/<button\b[^>]*data-testid="desk-validation"[^>]*>(.*?)<\/button>/s);
    expect(desk?.[1]).toContain("진행 중");
    expect(desk?.[1]).not.toContain("완료");
    expect(markup).toContain("진행 중 · 1개 작업");
  });

  it("모든 팀의 작업이 끝나도 실행 완료 이벤트 전에는 최종 완료로 요약하지 않는다", () => {
    const events = buildMockEvents();
    const before = events.slice(0, -1).reduce(officeReducer, initialOfficeState());
    const after = officeReducer(before, events.at(-1)!);
    expect(before.runStatus).toBe("running");
    expect(TEAMS.every((team) => before.teams[team].status === "completed")).toBe(true);
    expect(summary(render(before))).not.toBe(summary(render(after)));
    expect(summary(render(after))).toMatch(/끝났|완료/);
  });

  it.each([
    ["run.needs_input", "needs_input"],
    ["run.needs_revision", "needs_revision"],
  ] as const)("%s를 새 요청 대기나 진행 중 팀 요약과 구분한다", (type, status) => {
    const state = withRunEvent({ type, status, message: "테스트 확인 요청" });
    const current = summary(render(state));
    expect(current).not.toBe(summary(render(initialOfficeState())));
    expect(current).not.toContain("개 팀이 일하고");
  });

  it.each([
    ["run.failed", "failed"],
    ["run.superseded", "superseded"],
  ] as const)("%s 이후 남아 있는 진행 중 팀의 움직임을 정지한다", (type, status) => {
    const state = withRunEvent({ type, status });
    expect(state.teams.design.status).toBe("running");
    const markup = render(state);
    expect(markup).toContain('data-motion="paused"');
    expect(summary(markup)).not.toContain("개 팀이 일하고");
  });

  it("실행 오류와 재시도 가능 여부를 그대로 표시한다", () => {
    const error = { code: "SERVER_RESTART", message: "테스트 서버 재시작", retryable: true };
    const state = withRunEvent({ error });
    const markup = render(state, vi.fn());
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("SERVER_RESTART: 테스트 서버 재시작");
    expect(markup).toContain("다시 시도");
    expect(render(state)).not.toContain("다시 시도");
    expect(render(withRunEvent({ error: { ...error, retryable: false } }), vi.fn())).not.toContain(
      "다시 시도",
    );
  });
});
