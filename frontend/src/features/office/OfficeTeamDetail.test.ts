import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AgentEvent, Team } from "../../api/client";
import { buildMockEvents } from "./officeEvent.fixture";
import { OfficeTeamDetail } from "./OfficeTeamDetail";
import { initialOfficeState, officeReducer, type OfficeState } from "./officeState";

function render(state: OfficeState, team: Team) {
  return renderToStaticMarkup(
    createElement(OfficeTeamDetail, {
      state,
      team,
      id: "test-detail",
      paused: false,
      onClose: vi.fn(),
      onSelectTeam: vi.fn(),
    }),
  );
}

function upTo(count: number) {
  return buildMockEvents().slice(0, count).reduce(officeReducer, initialOfficeState());
}

describe("업무실 상세", () => {
  it("대기 중에는 진행 내용과 시간을 만들지 않는다", () => {
    const html = render(initialOfficeState(), "design");
    expect(html).toContain("아직 받은 작업이 없어요");
    expect(html).toContain("시간 기록 없음");
    expect(html).not.toContain("office-processing-track");
    expect(html).not.toContain("office-printed-receipt");
  });

  it("작업 시작 이벤트 수만큼 동시 검증을 표시하고, 받은 결과를 그대로 보여 준다", () => {
    const working = render(upTo(7), "validation");
    expect(working).toContain('aria-label="검증 작업 2개 진행 중"');
    expect(working).toContain("office-processing-track");
    expect(working).toContain("검증: 노트북 B 시작");
    const partial = render(upTo(9), "validation");
    expect(partial).toContain('aria-label="검증 작업 1개 진행 중"');
    expect(partial).toContain("노트북 A: 통과");
    expect(partial).not.toContain("노트북 B: 부적합");
  });

  it("견적팀 완료만으로 최종 출력 완료를 표시하지 않는다", () => {
    const before = render(upTo(12), "quotation");
    expect(before).toContain("최종 완료 기록은 아직 도착하지 않았어요");
    expect(before).not.toContain("견적서 출력 완료");
    const after = render(upTo(13), "quotation");
    expect(after).toContain("견적서 출력 완료");
    expect(after).toContain("참고 견적 2,190,000원");
  });

  it("중단 이벤트가 오면 남아 있는 작업을 진행 중으로 연출하지 않는다", () => {
    const event: AgentEvent = {
      ...buildMockEvents()[7],
      seq: 20,
      type: "run.failed",
      status: "failed",
      team: null,
      message: "테스트 중단",
    };
    const state = officeReducer(upTo(7), event);
    const html = render(state, "validation");
    expect(html).toContain('data-motion="paused"');
    expect(html).toContain('aria-label="검증 작업 2개 멈춤"');
    expect(html).not.toContain("office-processing-track");
  });

  it("요구사항 새 버전에는 이전 업무 상세를 섞지 않는다", () => {
    const event: AgentEvent = {
      ...buildMockEvents()[0],
      seq: 20,
      requirement_version: 2,
      message: "새 조건 접수",
    };
    const state = officeReducer(upTo(13), event);
    const html = render(state, "quotation");
    expect(html).toContain("요구사항 v2");
    expect(html).not.toContain("참고 견적 2,190,000원");
    expect(html).not.toContain("견적서 출력 완료");
  });
});
