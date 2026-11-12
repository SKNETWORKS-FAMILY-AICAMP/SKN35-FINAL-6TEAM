import type { AgentEvent, Team } from "../../api/client";
import { STATUS_LABELS, type OfficeState } from "./officeState";

function eventTime(event: AgentEvent): number {
  // API timestamps without an offset are UTC, just like the stored events.
  const timestamp = event.occurred_at;
  return Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(timestamp) ? timestamp : `${timestamp}Z`);
}

function durationText(milliseconds: number): string {
  if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`;
  const seconds = milliseconds / 1000;
  if (seconds < 60) return `${Number(seconds.toFixed(1))}초`;
  return `${Math.floor(seconds / 60)}분 ${Math.floor(seconds % 60)}초`;
}

export function eventClock(event: AgentEvent): string {
  const time = eventTime(event);
  return Number.isFinite(time)
    ? new Date(time).toLocaleTimeString("ko-KR", { hour12: false })
    : "시각 미확인";
}

export function teamPreview(state: OfficeState, team: Team) {
  const current = state.teams[team];
  const latest = current.log.at(-1);
  const runLog = latest ? current.log.filter((event) => event.run_id === latest.run_id) : [];
  const latestProgress = runLog.findLast((event) => event.type === "task.progress");
  const firstStart = runLog.find((event) => event.type === "task.started");
  const recentDuration = latest?.metrics?.duration_ms;
  let elapsed = "시간 기록 없음";
  let elapsedBasis = "이벤트에 시작·소요 시간이 없어요";

  if (
    current.activeTasks === 0 &&
    typeof recentDuration === "number" &&
    Number.isFinite(recentDuration) &&
    recentDuration >= 0
  ) {
    elapsed = durationText(recentDuration);
    elapsedBasis = "최근 작업의 서버 측정값";
  } else if (firstStart && latest && (current.log.length < 30 || runLog[0] !== current.log[0])) {
    // No client wall clock: mock playback, paused tabs and old sessions must not inflate this.
    // A clipped log cannot establish the team's actual start, so it stays unmeasured.
    const duration = eventTime(latest) - eventTime(firstStart);
    if (Number.isFinite(duration) && duration >= 0) {
      elapsed = durationText(duration);
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
    elapsedBasis,
  };
}
