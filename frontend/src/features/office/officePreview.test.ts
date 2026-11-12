import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../../api/client";
import { buildMockEvents } from "../../events/mockEventStream";
import { eventClock, teamPreview } from "./officePreview";
import { initialOfficeState, officeReducer } from "./officeState";

describe("teamPreview", () => {
  it("수신된 작업이 없으면 내용과 시간을 만들지 않는다", () => {
    expect(teamPreview(initialOfficeState(), "design")).toMatchObject({
      status: "대기",
      currentWork: null,
      latestProgress: null,
      recentEvents: [],
      elapsed: "시간 기록 없음",
    });
  });

  it("병렬 작업 상태와 최근 진행 메시지, 마지막 세 기록을 그대로 보여 준다", () => {
    const events = buildMockEvents();
    const state = events.slice(0, 9).reduce(officeReducer, initialOfficeState());
    const preview = teamPreview(state, "validation");
    expect(preview.status).toBe("진행 중");
    expect(preview.activeTasks).toBe(1);
    expect(preview.currentWork).toBe(events[8].message);
    expect(preview.recentEvents).toEqual([events[4], events[6], events[8]]);
    expect(preview.elapsed).toBe("2.8초");
    expect(teamPreview(state, "design").latestProgress).toBe(events[5].message);
  });

  it("완료 작업의 서버 소요 시간이 있으면 발생 시각 차이보다 우선한다", () => {
    const events = buildMockEvents();
    events[7] = { ...events[7], metrics: { duration_ms: 1240 } };
    const state = events.slice(0, 8).reduce(officeReducer, initialOfficeState());
    expect(teamPreview(state, "design")).toMatchObject({
      elapsed: "1.2초",
      elapsedBasis: "최근 작업의 서버 측정값",
    });
  });

  it("같은 요구사항의 재실행에 이전 실행의 시작 시각을 섞지 않는다", () => {
    const events = buildMockEvents();
    let state = events.reduce(officeReducer, initialOfficeState());
    const retry: AgentEvent = {
      ...events[2],
      seq: 14,
      run_id: "new-run",
      occurred_at: "2026-11-12T10:00:00Z",
    };
    state = officeReducer(state, retry);
    const preview = teamPreview(state, "design");
    expect(preview.elapsed).toBe("0ms");
    expect(preview.latestProgress).toBeNull();
  });

  it("누락되거나 잘린 시작 기록, 잘못된 시각으로 소요 시간을 추정하지 않는다", () => {
    const events = buildMockEvents();
    const state = initialOfficeState();
    state.teams.design = {
      status: "running",
      message: events[3].message,
      activeTasks: 1,
      log: [{ ...events[3], occurred_at: "invalid" }],
    };
    expect(teamPreview(state, "design").elapsed).toBe("시간 기록 없음");
    expect(eventClock(state.teams.design.log[0])).toBe("시각 미확인");
    state.teams.design.log = [
      events[2],
      ...Array.from({ length: 29 }, (_, i) => ({ ...events[3], seq: i + 4 })),
    ];
    expect(teamPreview(state, "design").elapsed).toBe("시간 기록 없음");
  });
});
