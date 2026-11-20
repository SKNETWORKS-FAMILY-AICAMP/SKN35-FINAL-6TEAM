import { describe, expect, it } from "vitest";
import type { AgentEvent } from "../../api/client";
import { buildMockEvents } from "./officeEvent.fixture";
import {
  handoff,
  latestQuote,
  printOut,
  runStopped,
  signalKind,
  teamHalted,
  validators,
} from "./officeCues";
import { OFFICE_FIXTURES, fixtureState } from "./officeFixtures";
import { initialOfficeState, officeReducer, type OfficeState } from "./officeState";

const events = buildMockEvents();

/** 기본 대본을 seq 번째 이벤트까지 받은 상태. */
function upTo(seq: number): OfficeState {
  return events.slice(0, seq).reduce(officeReducer, initialOfficeState());
}

function fixture(id: string): OfficeState {
  const found = OFFICE_FIXTURES.find((item) => item.id === id);
  if (!found) throw new Error(`견본이 없습니다: ${id}`);
  return fixtureState(found);
}

describe("서류 전달(handoff)", () => {
  it("기본 대본에서는 상담→설계(seq 3)와 검증→견적(seq 11)에서만 생긴다", () => {
    const found = events
      .map((event) => [event.seq, handoff(upTo(event.seq))] as const)
      .filter(([, cue]) => cue !== null);
    expect(found).toEqual([
      [3, { from: "consultation", to: "design", seq: 3 }],
      [11, { from: "validation", to: "quotation", seq: 11 }],
    ]);
  });

  it("앞 팀 이벤트가 진행 기록이면 서류를 넘기지 않는다", () => {
    expect(handoff(upTo(5))).toBeNull();
    expect(handoff(upTo(7))).toBeNull();
  });

  it("팀이 아닌 실행 이벤트가 뒤에 와도 마지막 팀 이벤트로만 판단한다", () => {
    expect(handoff(upTo(2))).toBeNull();
    expect(handoff(upTo(13))).toBeNull();
  });

  it("같은 팀 안에서 이어지는 작업은 전달이 아니다", () => {
    const state = officeReducer(upTo(8), {
      ...events[2],
      seq: 9,
      message: "후보 다시 탐색 시작",
    });
    expect(state.teams.design.log.at(-2)?.type).toBe("task.completed");
    expect(handoff(state)).toBeNull();
  });

  it("새 요구사항 버전이 오면 이전 버전의 전달을 다시 틀지 않는다", () => {
    const next = officeReducer(upTo(3), {
      ...events[3],
      seq: 4,
      requirement_version: 2,
    });
    expect(handoff(next)).toBeNull();
  });
});

describe("검증원 수(validators)", () => {
  it("검증팀의 동시 작업 수만큼 앉고, 끝나면 줄어든다", () => {
    expect(validators(upTo(4))).toEqual({ count: 0, overflow: 0 });
    expect(validators(upTo(5))).toEqual({ count: 1, overflow: 0 });
    expect(validators(upTo(7))).toEqual({ count: 2, overflow: 0 });
    expect(validators(upTo(9))).toEqual({ count: 1, overflow: 0 });
    expect(validators(upTo(10))).toEqual({ count: 0, overflow: 0 });
  });

  it("좌석 세 개를 넘으면 나머지는 overflow 로 센다", () => {
    let state = upTo(7);
    for (const seq of [8, 9, 10]) {
      state = officeReducer(state, { ...events[4], seq, message: `검증 ${seq} 시작` });
    }
    expect(state.teams.validation.activeTasks).toBe(5);
    expect(validators(state)).toEqual({ count: 3, overflow: 2 });
  });
});

describe("견적서 출력(printOut)과 견적 문장", () => {
  it("실행 완료 이벤트(seq 13)에서만 출력한다", () => {
    for (const event of events) {
      expect(printOut(upTo(event.seq))).toBe(event.seq === 13 ? 13 : null);
    }
  });

  it("실행이 실패하면 출력하지 않는다", () => {
    expect(printOut(fixture("failed-retryable"))).toBeNull();
  });

  it("견적·주문팀 작업 완료 문장을 그대로 돌려준다", () => {
    expect(latestQuote(upTo(11))).toBeNull();
    expect(latestQuote(upTo(12))?.message).toBe("참고 견적 2,190,000원");
  });

  it("같은 버전에서 견적을 다시 시작하면 지난 금액을 띄우지 않는다", () => {
    const quoted = upTo(12);
    const restarted = officeReducer(quoted, {
      ...events[10],
      seq: 30,
      message: "참고 견적 다시 작성",
    });
    expect(restarted.teams.quotation.status).toBe("running");
    expect(latestQuote(restarted)).toBeNull();
  });
});

describe("멈춤과 말풍선", () => {
  it("실행이 실패·취소·중단되면 멈춘 것으로 보고, 완료·확인 필요는 멈추지 않는다", () => {
    expect(runStopped(fixture("failed-retryable"))).toBe(true);
    expect(runStopped(fixture("cancelled"))).toBe(true);
    expect(runStopped(fixture("superseded"))).toBe(true);
    expect(runStopped(fixture("completed"))).toBe(false);
    expect(runStopped(fixture("needs-input"))).toBe(false);
    expect(runStopped(fixture("needs-revision"))).toBe(false);
  });

  it("실행이 멈췄는데 진행 중으로 남은 팀은 멈춤으로 그린다", () => {
    const state = fixture("superseded");
    expect(state.teams.design.status).toBe("running");
    expect(teamHalted(state, "design")).toBe(true);
    expect(teamHalted(state, "consultation")).toBe(false);
    expect(signalKind(state, "design")).toBe("stopped");
  });

  it("대기 중인 팀에는 말풍선이 없고, 상태마다 다른 말풍선을 쓴다", () => {
    expect(signalKind(initialOfficeState(), "design")).toBe("none");
    expect(signalKind(upTo(4), "design")).toBe("working");
    expect(signalKind(upTo(4), "quotation")).toBe("none");
    expect(signalKind(upTo(13), "quotation")).toBe("done");
    expect(signalKind(fixture("needs-input"), "design")).toBe("attention");
    expect(signalKind(fixture("needs-revision"), "design")).toBe("revision");
    expect(signalKind(fixture("failed-retryable"), "quotation")).toBe("failed");
    expect(signalKind(fixture("retrying"), "quotation")).toBe("retrying");
    expect(signalKind(fixture("cancelled"), "validation")).toBe("stopped");
  });

  it("상담팀은 요구사항 정리를 받으면 일한 방이 된다", () => {
    const state = upTo(1);
    const first: AgentEvent = events[0];
    expect(first.type).toBe("requirements.updated");
    expect(state.teams.consultation.status).toBe("completed");
    expect(signalKind(state, "consultation")).toBe("done");
  });
});
