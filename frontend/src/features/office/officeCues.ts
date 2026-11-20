/**
 * 사무실 장면의 연출 신호. 받은 이벤트(오피스 상태)에서만 만듭니다.
 *
 * 연출은 가장 최근 이벤트 하나로만 정합니다. 그래서 다시 연결되어 같은 이벤트가 또 와도,
 * 시연을 처음부터 다시 틀어도 지난 연출을 다시 재생하지 않습니다.
 */
import type { AgentEvent, Team } from "../../api/client";
import { TEAMS, type DisplayStatus, type OfficeState } from "./officeState";

export interface Handoff {
  from: Team;
  to: Team;
  seq: number;
}

export interface Validators {
  /** 검증팀 방에 앉는 직원 수(최대 좌석 수까지). */
  count: number;
  /** 좌석보다 많은 동시 작업 수. 화면에는 '+n' 으로 씁니다. */
  overflow: number;
}

export type SignalKind =
  "none" | "working" | "retrying" | "done" | "attention" | "revision" | "failed" | "stopped";

export const VALIDATOR_SEATS = 3;

const STOPPED_RUN: DisplayStatus[] = ["failed", "cancelled", "superseded"];

/** 실행이 실패·취소·중단되어 더 진행하지 않는 상태. 장면을 멈추는 기준입니다. */
export function runStopped(state: OfficeState): boolean {
  return STOPPED_RUN.includes(state.runStatus);
}

/** 실행은 멈췄는데 그 팀의 마지막 기록이 아직 '진행 중' 인 경우. */
export function teamHalted(state: OfficeState, team: Team): boolean {
  return runStopped(state) && state.teams[team].status === "running";
}

function teamEvents(state: OfficeState): AgentEvent[] {
  return TEAMS.flatMap((team) => state.teams[team].log)
    .filter((event) => event.requirement_version === state.version && event.seq <= state.lastSeq)
    .sort((first, second) => first.seq - second.seq);
}

/**
 * 서류 전달: 가장 최근 팀 이벤트가 작업 시작이고, 바로 앞 팀 이벤트가 다른 팀의 작업 완료이거나
 * 상담팀의 요구사항 정리일 때만 앞 팀에서 새 팀으로 서류가 건너갑니다.
 */
export function handoff(state: OfficeState): Handoff | null {
  const events = teamEvents(state);
  const latest = events.at(-1);
  const previous = events.at(-2);
  if (!latest?.team || !previous?.team) return null;
  if (latest.type !== "task.started" || previous.team === latest.team) return null;
  const passed =
    previous.type === "task.completed" ||
    (previous.type === "requirements.updated" && previous.team === "consultation");
  return passed ? { from: previous.team, to: latest.team, seq: latest.seq } : null;
}

/** 검증팀이 동시에 하는 작업 수만큼 직원이 앉습니다. 좌석을 넘으면 나머지는 '+n' 입니다. */
export function validators(state: OfficeState): Validators {
  const active = Math.max(0, state.teams.validation.activeTasks);
  return {
    count: Math.min(active, VALIDATOR_SEATS),
    overflow: Math.max(0, active - VALIDATOR_SEATS),
  };
}

/** 실행 완료 이벤트를 받았을 때만 견적서가 출력됩니다. 그 이벤트의 순번을 돌려줍니다. */
export function printOut(state: OfficeState): number | null {
  return state.runEvent?.type === "run.completed" ? state.runEvent.seq : null;
}

/**
 * 견적·주문팀이 끝낸 작업의 마지막 기록. 금액은 이 문장 그대로 씁니다.
 * 같은 요구사항 버전에서 견적을 다시 시작했으면(마지막 기록이 완료가 아니면) 지난 금액을 띄우지 않습니다.
 */
export function latestQuote(state: OfficeState): AgentEvent | null {
  const last = state.teams.quotation.log.at(-1);
  return last?.type === "task.completed" ? last : null;
}

/** 직원 머리 위 말풍선의 종류. 대기 중인 팀에는 말풍선을 그리지 않습니다. */
export function signalKind(state: OfficeState, team: Team): SignalKind {
  const current = state.teams[team];
  if (teamHalted(state, team)) return "stopped";
  switch (current.status) {
    case "running":
      return current.log.at(-1)?.type === "task.retrying" ? "retrying" : "working";
    case "completed":
      return "done";
    case "needs_input":
      return "attention";
    case "needs_revision":
      return "revision";
    case "failed":
      return "failed";
    case "cancelled":
    case "superseded":
      return "stopped";
    default:
      return "none";
  }
}
