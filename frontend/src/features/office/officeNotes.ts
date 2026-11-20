/**
 * 대화 기록에 끼워 넣을 팀 작업 기록. 오피스 상태(받은 이벤트)에서만 만듭니다.
 * 상담 직원의 말이 아니라 업무팀의 작업 기록이라 대화 말풍선과 따로 그립니다.
 */
import type { AgentEvent, Team } from "../../api/client";
import { TEAMS, type DisplayStatus, type OfficeState } from "./officeState";

export interface TeamNote {
  seq: number;
  team: Team;
  type: AgentEvent["type"];
  status: DisplayStatus;
  message: string;
  occurredAt: string;
}

export const TEAM_NOTE_LIMIT = 12;

/** 지금 요구사항 버전에서 받은 팀 이벤트를 순번 순으로. 요구사항 정리(상담 답)는 대화 쪽이 그립니다. */
export function teamNotesForOffice(office: OfficeState, limit = TEAM_NOTE_LIMIT): TeamNote[] {
  if (office.version === 0) return [];
  const bySeq = new Map<number, TeamNote>();
  for (const team of TEAMS) {
    for (const event of office.teams[team].log) {
      if (event.requirement_version !== office.version) continue;
      if (event.seq > office.lastSeq || event.type === "requirements.updated") continue;
      bySeq.set(event.seq, {
        seq: event.seq,
        team,
        type: event.type,
        status: event.status,
        message: event.message,
        occurredAt: event.occurred_at,
      });
    }
  }
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq).slice(-limit);
}
