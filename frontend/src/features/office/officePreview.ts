import type { AgentEvent, Team } from "../../api/client";
import { STATUS_LABELS, type OfficeState } from "./officeState";

/** 걸린 시간을 무엇으로 쟀는지. 화면 문구는 이 값으로 고릅니다. */
export type ElapsedKind = "server" | "events" | "none";

// 대화 기록(transcript.ts)과 같은 설정이라 같은 이벤트는 어디서나 같은 시각으로 찍힙니다.
const CLOCK = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function parseTime(timestamp: string): number {
  // API timestamps without an offset are UTC, just like the stored events.
  return Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(timestamp) ? timestamp : `${timestamp}Z`);
}

function eventTime(event: AgentEvent): number {
  return parseTime(event.occurred_at);
}

function durationText(milliseconds: number): string {
  if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`;
  const seconds = milliseconds / 1000;
  if (seconds < 60) return `${Number(seconds.toFixed(1))}초`;
  return `${Math.floor(seconds / 60)}분 ${Math.floor(seconds % 60)}초`;
}

/** 한국 시각 'HH:MM:SS'. 읽을 수 없는 시각은 지어내지 않고 '시각 미확인' 으로 씁니다. */
export function clockText(timestamp: string): string {
  const time = parseTime(timestamp);
  return Number.isFinite(time) ? CLOCK.format(time) : "시각 미확인";
}

export function eventClock(event: AgentEvent): string {
  return clockText(event.occurred_at);
}

export function teamPreview(state: OfficeState, team: Team) {
  const current = state.teams[team];
  const latest = current.log.at(-1);
  const runLog = latest ? current.log.filter((event) => event.run_id === latest.run_id) : [];
  const latestProgress = runLog.findLast((event) => event.type === "task.progress");
  const firstStart = runLog.find((event) => event.type === "task.started");
  const recentDuration = latest?.metrics?.duration_ms;
  let elapsed = "시간 기록 없음";
  let elapsedKind: ElapsedKind = "none";
  let elapsedBasis = "이벤트에 시작·소요 시간이 없어요";

  if (
    current.activeTasks === 0 &&
    typeof recentDuration === "number" &&
    Number.isFinite(recentDuration) &&
    recentDuration >= 0
  ) {
    elapsed = durationText(recentDuration);
    elapsedKind = "server";
    elapsedBasis = "최근 작업의 서버 측정값";
  } else if (firstStart && latest && (current.log.length < 30 || runLog[0] !== current.log[0])) {
    // No client wall clock: mock playback, paused tabs and old sessions must not inflate this.
    // A clipped log cannot establish the team's actual start, so it stays unmeasured.
    const duration = eventTime(latest) - eventTime(firstStart);
    if (Number.isFinite(duration) && duration >= 0) {
      elapsed = durationText(duration);
      elapsedKind = "events";
      elapsedBasis = "팀 시작 → 마지막 수신 이벤트";
    }
  }

  return {
    status: STATUS_LABELS[current.status],
    currentWork: current.message || null,
    activeTasks: current.activeTasks,
    latestProgress: latestProgress?.message ?? null,
    recentEvents: current.log.slice(-3),
    elapsed,
    elapsedKind,
    // 기존 시험이 고정한 설명이라 값은 그대로 둡니다. 화면 문구는 elapsedKind 로 고릅니다.
    elapsedBasis,
  };
}
