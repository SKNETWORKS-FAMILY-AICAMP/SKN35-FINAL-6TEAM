/**
 * 오피스 화면 상태. 이벤트만으로 바뀝니다 — 애니메이션을 위해 상태를 지어내지 않습니다.
 *
 * 규칙
 * - 이미 받은 순번(seq) 이하의 이벤트는 무시합니다(재연결 때 다시 온 이벤트).
 * - 지금 보고 있는 요구사항 버전보다 오래된 이벤트는 화면에 반영하지 않습니다.
 * - 새 버전 이벤트가 오면 업무팀 칸을 비우고 그 버전으로 다시 그립니다.
 */
import type { AgentEvent, EventError, Team, WorkStatus } from "../../api/client";

export const TEAMS: Team[] = ["consultation", "design", "validation", "quotation"];

export const TEAM_LABELS: Record<Team, string> = {
  consultation: "상담팀",
  design: "설계·분석팀",
  validation: "검증팀",
  quotation: "견적·주문팀",
};

export type DisplayStatus = WorkStatus | "idle";

export const STATUS_LABELS: Record<DisplayStatus, string> = {
  idle: "대기",
  pending: "대기",
  running: "진행 중",
  needs_input: "고객 확인 필요",
  needs_revision: "재검토 필요",
  completed: "완료",
  failed: "실패",
  cancelled: "취소",
  superseded: "이전 요청(중단)",
};

export interface TeamState {
  status: DisplayStatus;
  message: string;
  activeTasks: number;
  log: AgentEvent[];
}

export interface OfficeState {
  version: number;
  lastSeq: number;
  runStatus: DisplayStatus;
  runMessage: string;
  runError: EventError | null;
  teams: Record<Team, TeamState>;
}

const LOG_LIMIT = 30;

function emptyTeams(): Record<Team, TeamState> {
  return Object.fromEntries(
    TEAMS.map((team) => [team, { status: "idle", message: "", activeTasks: 0, log: [] }]),
  ) as unknown as Record<Team, TeamState>;
}

export function initialOfficeState(): OfficeState {
  return {
    version: 0,
    lastSeq: 0,
    runStatus: "idle",
    runMessage: "",
    runError: null,
    teams: emptyTeams(),
  };
}

function applyTeam(team: TeamState, event: AgentEvent): TeamState {
  let activeTasks = team.activeTasks;
  if (event.type === "task.started") activeTasks += 1;
  if (event.type === "task.completed" || event.type === "task.failed") {
    activeTasks = Math.max(0, activeTasks - 1);
  }
  // 같은 팀 작업이 여러 개 동시에 돌 때(검증팀), 하나가 끝나도 나머지가 돌고 있으면 '진행 중' 입니다.
  const status: DisplayStatus =
    activeTasks > 0 && event.status === "completed" ? "running" : event.status;
  return {
    status,
    message: event.message,
    activeTasks,
    log: [...team.log, event].slice(-LOG_LIMIT),
  };
}

export function officeReducer(state: OfficeState, event: AgentEvent): OfficeState {
  if (event.seq <= state.lastSeq) return state;
  let next: OfficeState = { ...state, lastSeq: event.seq };

  if (event.requirement_version < state.version) return next;
  if (event.requirement_version > state.version) {
    next = {
      ...next,
      version: event.requirement_version,
      runStatus: "pending",
      runMessage: "",
      runError: null,
      teams: emptyTeams(),
    };
  }

  if (event.type.startsWith("run.")) {
    next = {
      ...next,
      runStatus: event.status,
      runMessage: event.message,
      runError: event.error ?? null,
    };
  }

  if (event.team) {
    next = {
      ...next,
      teams: { ...next.teams, [event.team]: applyTeam(next.teams[event.team], event) },
    };
  }
  return next;
}
