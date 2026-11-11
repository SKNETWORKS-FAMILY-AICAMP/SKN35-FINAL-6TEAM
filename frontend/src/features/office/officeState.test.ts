import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../../api/client";
import { buildMockEvents } from "../../events/mockEventStream";
import { initialOfficeState, officeReducer } from "./officeState";

function event(overrides: Partial<AgentEvent>): AgentEvent {
  return {
    seq: 1,
    session_id: "s",
    company_id: 1,
    run_id: "r",
    requirement_version: 1,
    team: "design",
    type: "task.started",
    status: "running",
    occurred_at: "2026-11-11T00:00:00Z",
    message: "",
    error: null,
    artifact: null,
    metrics: null,
    ...overrides,
  };
}

describe("officeReducer", () => {
  it("이미 받은 순번은 다시 반영하지 않는다(재연결)", () => {
    const first = officeReducer(initialOfficeState(), event({ seq: 1, message: "처음" }));
    const again = officeReducer(first, event({ seq: 1, message: "다시 온 것" }));
    expect(again).toBe(first);
  });

  it("새 버전이 오면 이전 버전 이벤트는 화면에 반영하지 않는다", () => {
    let state = officeReducer(initialOfficeState(), event({ seq: 1, requirement_version: 1 }));
    state = officeReducer(
      state,
      event({
        seq: 2,
        requirement_version: 2,
        team: "consultation",
        type: "requirements.updated",
        status: "completed",
      }),
    );
    const late = officeReducer(
      state,
      event({ seq: 3, requirement_version: 1, type: "task.completed", status: "completed" }),
    );
    expect(late.version).toBe(2);
    expect(late.lastSeq).toBe(3);
    expect(late.teams.design.status).toBe("idle");
  });

  it("검증팀 작업이 여러 개면 모두 끝나야 완료로 보인다", () => {
    let state = initialOfficeState();
    const steps: Partial<AgentEvent>[] = [
      { seq: 1, team: "validation", type: "task.started", status: "running" },
      { seq: 2, team: "validation", type: "task.started", status: "running" },
      { seq: 3, team: "validation", type: "task.completed", status: "completed" },
    ];
    for (const step of steps) state = officeReducer(state, event(step));
    expect(state.teams.validation.status).toBe("running");

    state = officeReducer(
      state,
      event({ seq: 4, team: "validation", type: "task.completed", status: "completed" }),
    );
    expect(state.teams.validation.status).toBe("completed");
  });

  it("실패 이벤트의 오류 정보를 보관한다", () => {
    const state = officeReducer(
      initialOfficeState(),
      event({
        team: null,
        type: "run.failed",
        status: "failed",
        error: { code: "SERVER_RESTART", message: "서버 재시작", retryable: true },
      }),
    );
    expect(state.runStatus).toBe("failed");
    expect(state.runError?.retryable).toBe(true);
  });

  it("가짜 대본을 끝까지 돌리면 모든 팀이 완료된다", () => {
    const state = buildMockEvents().reduce(officeReducer, initialOfficeState());
    expect(state.runStatus).toBe("completed");
    expect(Object.values(state.teams).every((team) => team.status === "completed")).toBe(true);
  });
});
