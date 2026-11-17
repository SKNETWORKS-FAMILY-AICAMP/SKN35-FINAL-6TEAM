import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "../../api/client";
import { buildMockEvents } from "../../events/mockEventStream";
import { OfficeBoard } from "./OfficeBoard";
import { OFFICE_FIXTURES, fixtureState } from "./officeFixtures";
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

function upTo(seq: number) {
  return buildMockEvents().slice(0, seq).reduce(officeReducer, initialOfficeState());
}

function fixture(id: string) {
  const found = OFFICE_FIXTURES.find((item) => item.id === id);
  if (!found) throw new Error(`견본이 없습니다: ${id}`);
  return fixtureState(found);
}

function desk(markup: string, team: string) {
  const match = markup.match(
    new RegExp(`<button\\b[^>]*data-testid="desk-${team}"[^>]*>(.*?)</button>`, "s"),
  );
  if (!match) throw new Error(`방을 찾을 수 없습니다: ${team}`);
  return match[0];
}

function count(markup: string, pattern: RegExp) {
  return markup.match(pattern)?.length ?? 0;
}

function visibleText(markup: string) {
  return markup
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

describe("OfficeBoard 사무실 화면", () => {
  it("완료·확인 필요·재검토에서는 장면을 멈추지 않는다", () => {
    for (const state of [upTo(13), fixture("needs-input"), fixture("needs-revision")]) {
      expect(render(state)).toContain('data-motion="playing"');
    }
    expect(render(fixture("cancelled"))).toContain('data-motion="paused"');
  });

  it("머리에는 제목·실행 상태·요약·완료 수·움직임 버튼만 두고, 지운 띠는 다시 나오지 않는다", () => {
    const markup = render(upTo(9));
    expect(markup).toContain("AI 팀 사무실");
    expect(markup).toContain("완료 2/4팀");
    expect(markup).toContain('aria-pressed="false"');
    expect(markup).toContain("움직임 멈춤");
    expect(count(markup, /role="status"/g)).toBe(1);
    expect(markup).not.toContain("aria-live");
    for (const removed of [
      "office-team-list",
      "office-legend",
      "office-map-toolbar",
      "office-hall-label",
      "office-intro",
      "office-room-number",
    ]) {
      expect(markup).not.toContain(removed);
    }
  });

  it("화면 글자에 영문 장식 라벨과 옛 표현이 없다", () => {
    for (const state of [initialOfficeState(), upTo(7), upTo(13), fixture("superseded")]) {
      const text = visibleText(render(state));
      expect(text).not.toMatch(/\b(?!BUILDWISE\b)[A-Z]{4,}\b/);
      expect(text).not.toMatch(/오피스|워크스페이스|데모|Mock|전사|당신의/);
    }
    expect(render(initialOfficeState())).not.toContain("AI 오피스");
  });

  it("요약 문구는 실행 상태를 따른다", () => {
    expect(summary(render(upTo(13)))).toBe("요청을 모두 완료했어요");
    expect(summary(render(fixture("failed-final")))).toBe("작업 중 문제가 생겼어요");
    expect(summary(render(fixture("superseded")))).toBe("새 요청이 들어와 이 작업은 멈췄어요");
    expect(summary(render(upTo(7)))).toBe("2개 팀이 일하고 있어요");
  });

  it("방 칩은 픽셀 아이콘과 한글 라벨을 같이 두고, 진행 중 방에는 작업 수를 붙인다", () => {
    const validation = desk(render(upTo(7)), "validation");
    expect(validation).toContain('class="office-chip chip-working"');
    expect(validation).toContain('class="office-icon"');
    expect(validation).toContain("진행 중 · 2개 작업");
    expect(desk(render(upTo(13)), "quotation")).toContain("완료");
  });

  it("실행이 멈췄는데 진행 중으로 남은 팀은 멈춤으로 표시한다", () => {
    const design = desk(render(fixture("superseded")), "design");
    expect(design).toContain("is-halted");
    expect(design).toContain("진행 중 · 멈춤");
    expect(design).toContain("chip-stopped");
  });

  it("대기 중인 방에는 말풍선을 그리지 않는다", () => {
    expect(count(render(initialOfficeState()), /class="office-signal"/g)).toBe(0);
    // seq 4: 상담팀(요구사항 정리 완료)과 설계·분석팀(진행 중)만 말풍선이 있다.
    expect(count(render(upTo(4)), /class="office-signal"/g)).toBe(2);
  });

  it("지도 아래 띠는 평소 현재 요청과 최근 기록, 견적이 오면 그 문장을 크게 보여 준다", () => {
    expect(render(initialOfficeState())).toContain("상담을 시작하면 네 팀의 작업이 여기에 나와요");
    const working = render(upTo(4));
    expect(working).toContain("요구사항 v1 정리: 노트북 · 예산 2,500,000원");
    expect(working).toMatch(/설계·분석팀<\/span><span class="office-recent-message">후보 1:/);
    expect(working).not.toContain("office-quote-value");
    const quoted = render(upTo(12));
    expect(quoted).toContain('<strong class="office-quote-value">참고 견적 2,190,000원</strong>');
    expect(quoted).toContain("가상 상품 기준");
    expect(quoted).toContain('href="#results"');
  });

  it("서류 봉투·검증원·견적서는 그 이벤트를 받았을 때만 나온다", () => {
    expect(render(upTo(3))).toContain("office-cue-envelope");
    expect(render(upTo(4))).not.toContain("office-cue-envelope");
    expect(render(upTo(11))).toContain("office-cue-envelope");
    expect(count(render(upTo(7)), /class="office-validator"/g)).toBe(1);
    expect(count(render(upTo(9)), /class="office-validator"/g)).toBe(0);
    expect(render(upTo(12))).not.toContain("office-printout");
    expect(render(upTo(13))).toContain("office-printout");
  });

  it("실패한 방 옆 다시 시도는 기존 재시도 조건을 그대로 따른다", () => {
    const retry = /class="office-room-retry retry-quotation"/;
    expect(render(fixture("failed-retryable"), vi.fn())).toMatch(retry);
    expect(render(fixture("failed-retryable"))).not.toMatch(retry);
    expect(render(fixture("failed-final"), vi.fn())).not.toMatch(retry);
  });
});
