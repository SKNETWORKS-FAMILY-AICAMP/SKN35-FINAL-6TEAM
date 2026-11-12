import { useEffect, useState } from "react";
import type { ChatMessage } from "../../api/client";
import { TEAMS, type OfficeState } from "../office/officeState";
import { initialChatState, type ChatState } from "./chatState";

// 가상 고객 문장과 NLU입니다. 기존 mockEventStream의 노트북·250만 원 조건과 같습니다.
export const MOCK_CUSTOMER_TEXT = "예산 250만 원으로 노트북을 추천해 주세요.";

/** 이미 수신한 오피스 이벤트만 대본으로 보여 줍니다. 실제 채팅 상태에는 합치지 않습니다. */
export function mockChatForOffice(office: OfficeState): ChatState {
  if (office.version === 0) return initialChatState();
  const bySeq = new Map(
    TEAMS.flatMap((team) => office.teams[team].log)
      .filter(
        (event) => event.requirement_version === office.version && event.seq <= office.lastSeq,
      )
      .map((event) => [event.seq, event]),
  );
  const events = [...bySeq.values()].sort((a, b) => a.seq - b.seq);
  const requirement = events.find((event) => event.type === "requirements.updated");
  const messages: ChatMessage[] = [];

  if (requirement) {
    messages.push({
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
    });
  }

  for (const event of events.slice(-(12 - messages.length))) {
    messages.push({
      id: event.seq * 2,
      session_id: event.session_id,
      role: "assistant",
      content: event.message,
      quick_replies: [],
      nlu: null,
      created_at: event.occurred_at,
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
