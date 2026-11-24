import type { ChatMessage } from "../../api/client";
import type { TeamNote } from "../office/officeNotes";
import type { DisplayStatus } from "../office/officeState";
import type { VoicePhase } from "./voiceState";

export type TranscriptEntry =
  { kind: "message"; message: ChatMessage } | { kind: "notes"; notes: TeamNote[] };

function timeOf(iso: string): number {
  const value = iso.trim();
  // 시간대 없는 DB 시각은 UTC 로 읽습니다(formatMessageTime 과 같은 약속).
  return Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`);
}

/**
 * 대화 말풍선과 팀 작업 기록을 시각 순으로 섞습니다.
 * 대화는 받은 순서를, 팀 기록은 seq 순서를 그대로 지킵니다. 시각이 같으면 대화가 먼저입니다.
 * 이어지는 팀 기록은 한 묶음으로 돌려줍니다(묶음 위에 구분선을 한 번 그리려고).
 */
export function mergeTranscript(
  messages: readonly ChatMessage[],
  notes: readonly TeamNote[],
): TranscriptEntry[] {
  const sorted = [...notes].sort((a, b) => a.seq - b.seq);
  const entries: TranscriptEntry[] = [];
  const pushNote = (note: TeamNote) => {
    const last = entries.at(-1);
    if (last?.kind === "notes") last.notes.push(note);
    else entries.push({ kind: "notes", notes: [note] });
  };
  let n = 0;
  for (const message of messages) {
    const at = timeOf(message.created_at);
    while (n < sorted.length && timeOf(sorted[n].occurredAt) < at) pushNote(sorted[n++]);
    entries.push({ kind: "message", message });
  }
  while (n < sorted.length) pushNote(sorted[n++]);
  return entries;
}

/**
 * 콘솔이 보여 줄 단계. 실제 음성 단계가 대기(idle)일 때만 받은 이벤트에서 파생합니다.
 * 진행률이나 남은 시간은 만들지 않습니다.
 */
export type ConsoleDisplay = VoicePhase | "working" | "waiting" | "done";

export function consoleDisplay(
  phase: VoicePhase,
  runStatus: DisplayStatus | undefined,
): ConsoleDisplay {
  if (phase !== "idle") return phase;
  if (runStatus === "pending" || runStatus === "running") return "working";
  if (runStatus === "needs_input") return "waiting";
  if (runStatus === "completed") return "done";
  return "idle";
}
