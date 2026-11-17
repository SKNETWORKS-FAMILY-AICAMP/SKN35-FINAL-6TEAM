import { useEffect, useState } from "react";
import type { ChatMessage } from "../../api/client";
import type { TeamNote } from "../office/officeNotes";
import { TEAMS, type DisplayStatus, type OfficeState } from "../office/officeState";
import { initialChatState, type ChatState } from "./chatState";
import type { VoicePhase } from "./voiceState";

// 가상 고객 문장과 NLU입니다. 기존 mockEventStream의 노트북·250만 원 조건과 같습니다.
export const MOCK_CUSTOMER_TEXT = "예산 250만 원으로 노트북을 추천해 주세요.";

/**
 * 이미 받은 오피스 이벤트로 시연 대화만 만듭니다. 실제 채팅 상태에는 합치지 않습니다.
 * 고객 요청, 상담 직원의 요구사항 정리, 실행이 끝났을 때의 마무리 답까지만 대화입니다.
 * 업무팀 작업은 상담 직원의 말이 아니라서 여기 넣지 않습니다(teamNotesForOffice 가 따로 만듭니다).
 */
export function mockChatForOffice(office: OfficeState): ChatState {
  if (office.version === 0) return initialChatState();
  const requirement = TEAMS.flatMap((team) => office.teams[team].log)
    .filter(
      (event) =>
        event.type === "requirements.updated" &&
        event.requirement_version === office.version &&
        event.seq <= office.lastSeq,
    )
    .sort((a, b) => a.seq - b.seq)
    .at(-1);
  const messages: ChatMessage[] = [];

  if (requirement) {
    messages.push(
      {
        id: requirement.seq * 2 - 1,
        session_id: requirement.session_id,
        role: "user",
        content: MOCK_CUSTOMER_TEXT,
        quick_replies: [],
        nlu: {
          intent: "new_recommendation",
          confidence: 1,
          slots: { budget_max: 2_500_000, product_types: ["laptop"] },
          source: "mock_fixture",
        },
        created_at: requirement.occurred_at,
      },
      {
        id: requirement.seq * 2,
        session_id: requirement.session_id,
        role: "assistant",
        content: requirement.message,
        quick_replies: [],
        nlu: null,
        created_at: requirement.occurred_at,
      },
    );
  }

  const closing = office.runEvent;
  if (
    office.runStatus === "completed" &&
    closing &&
    closing.requirement_version === office.version &&
    closing.seq <= office.lastSeq
  ) {
    messages.push({
      id: closing.seq * 2,
      session_id: closing.session_id,
      role: "assistant",
      content: closing.message,
      quick_replies: [],
      nlu: null,
      created_at: closing.occurred_at,
    });
  }

  return { messages, pending: null, error: null };
}

export function useMockTranscript(office: OfficeState, enabled: boolean) {
  const [preview, setPreview] = useState({ draft: "", draftAt: null as string | null });
  const waitingForRequest = enabled && office.version === 0;

  useEffect(() => {
    if (!waitingForRequest) return;
    let length = 0;
    const draftAt = new Date().toISOString();
    const timer = window.setInterval(() => {
      length = Math.min(MOCK_CUSTOMER_TEXT.length, length + 3);
      setPreview({ draft: MOCK_CUSTOMER_TEXT.slice(0, length), draftAt });
      if (length === MOCK_CUSTOMER_TEXT.length) window.clearInterval(timer);
    }, 60);
    return () => window.clearInterval(timer);
  }, [waitingForRequest]);

  return {
    chat: enabled ? mockChatForOffice(office) : initialChatState(),
    draft: waitingForRequest ? preview.draft : "",
    draftAt: waitingForRequest ? preview.draftAt : null,
  };
}

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
export type ConsoleDisplay = VoicePhase | "drafting" | "working" | "waiting" | "done";

export function consoleDisplay(
  phase: VoicePhase,
  runStatus: DisplayStatus | undefined,
  mockDraft: string,
): ConsoleDisplay {
  if (phase !== "idle") return phase;
  if (mockDraft) return "drafting";
  if (runStatus === "pending" || runStatus === "running") return "working";
  if (runStatus === "needs_input") return "waiting";
  if (runStatus === "completed") return "done";
  return "idle";
}
