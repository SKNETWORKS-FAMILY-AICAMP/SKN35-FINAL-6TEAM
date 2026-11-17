import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../../api/client";
import { buildMockEvents } from "../../events/mockEventStream";
import { teamNotesForOffice, type TeamNote } from "../office/officeNotes";
import { initialOfficeState, officeReducer } from "../office/officeState";
import { conditionTags } from "./transcript";
import {
  MOCK_CUSTOMER_TEXT,
  consoleDisplay,
  mergeTranscript,
  mockChatForOffice,
} from "./mockTranscript";

describe("mockChatForOffice", () => {
  it("수신한 이벤트가 없으면 확정 대사를 표시하지 않는다", () => {
    expect(mockChatForOffice(initialOfficeState())).toEqual({
      messages: [],
      pending: null,
      error: null,
    });
  });

  it("실제 mock 이벤트의 각 수신 단계에서 대화는 요구사항 정리와 받은 마무리 답뿐이다", () => {
    const events = buildMockEvents();
    for (let count = 1; count <= events.length; count += 1) {
      const received = events.slice(0, count);
      const office = received.reduce(officeReducer, initialOfficeState());
      const chat = mockChatForOffice(office);
      // 의도한 명세 변경: 업무팀 이벤트는 대화가 아니라 팀 작업 기록이다.
      const expected = received.filter(
        (event) => event.type === "requirements.updated" || event.type === "run.completed",
      );
      expect(chat.messages[0].content).toBe(MOCK_CUSTOMER_TEXT);
      expect(chat.messages.filter((message) => message.role === "assistant")).toEqual(
        expected.map((event) => ({
          id: event.seq * 2,
          session_id: event.session_id,
          role: "assistant",
          content: event.message,
          quick_replies: [],
          nlu: null,
          created_at: event.occurred_at,
        })),
      );
      for (const future of events.slice(count)) {
        expect(chat.messages.some((message) => message.content === future.message)).toBe(false);
      }
    }
  });

  it("업무팀 작업 이벤트는 상담 직원 답으로 내보내지 않는다", () => {
    const events = buildMockEvents();
    const office = events.reduce(officeReducer, initialOfficeState());
    const contents = mockChatForOffice(office).messages.map((message) => message.content);
    for (const event of events.filter((item) => item.type.startsWith("task."))) {
      expect(contents).not.toContain(event.message);
    }
    expect(mockChatForOffice(office).messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "assistant",
    ]);
  });

  it("마무리 답은 run.completed 를 받은 뒤에만 나오고 그 이벤트의 시각을 쓴다", () => {
    const events = buildMockEvents();
    const last = events.at(-1)!;
    expect(last.type).toBe("run.completed");
    const before = events.slice(0, -1).reduce(officeReducer, initialOfficeState());
    expect(mockChatForOffice(before).messages.map((message) => message.content)).not.toContain(
      last.message,
    );
    const after = officeReducer(before, last);
    const closing = mockChatForOffice(after).messages.at(-1)!;
    expect(closing.content).toBe(last.message);
    expect(closing.created_at).toBe(last.occurred_at);
    expect(closing.role).toBe("assistant");
  });

  it("수신 이벤트의 시각·순서를 보존하고 같은 이벤트가 다시 와도 중복하지 않는다", () => {
    const events = buildMockEvents("mock-test");
    const office = events.reduce(officeReducer, initialOfficeState());
    const chat = mockChatForOffice(office);
    expect(chat.messages.length).toBeLessThanOrEqual(12);
    expect(chat.messages.every((message) => message.session_id === "mock-test")).toBe(true);
    expect(chat.messages.map((message) => message.id)).toEqual(
      [...chat.messages.map((message) => message.id)].sort((a, b) => a - b),
    );
    const times = chat.messages.map((message) => Date.parse(message.created_at));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(chat.messages[0].created_at).toBe(events[0].occurred_at);
    expect(mockChatForOffice(officeReducer(office, events[0]))).toEqual(chat);
  });

  it("가상 고객의 NLU는 기존 mock 조건만 담고 시험용임을 구분한다", () => {
    const [event] = buildMockEvents();
    const { messages } = mockChatForOffice(officeReducer(initialOfficeState(), event));
    expect(messages[0].nlu?.source).toBe("mock_fixture");
    expect(conditionTags(messages[0])).toEqual([
      { label: "예산", value: "2,500,000원" },
      { label: "상품 유형", value: "노트북" },
    ]);
    expect(conditionTags(messages[1])).toEqual([]);
  });

  it("새 버전이면 이전 버전의 견적을 끌어오지 않는다", () => {
    const events = buildMockEvents();
    const office = events.reduce(officeReducer, initialOfficeState());
    const newer = officeReducer(office, {
      ...events[0],
      seq: office.lastSeq + 1,
      requirement_version: office.version + 1,
      message: "요구사항 새 버전 접수",
    });
    expect(mockChatForOffice(newer).messages.map((message) => message.content)).toEqual([
      MOCK_CUSTOMER_TEXT,
      "요구사항 새 버전 접수",
    ]);
  });
});

function message(id: number, role: ChatMessage["role"], at: string): ChatMessage {
  return {
    id,
    session_id: "s",
    role,
    content: `m${id}`,
    quick_replies: [],
    nlu: null,
    created_at: at,
  };
}

function note(seq: number, at: string): TeamNote {
  return {
    seq,
    team: "design",
    type: "task.progress",
    status: "running",
    message: `n${seq}`,
    occurredAt: at,
  };
}

describe("mergeTranscript", () => {
  it("대화와 팀 기록을 시각 순으로 섞고 이어지는 팀 기록을 한 묶음으로 둔다", () => {
    const entries = mergeTranscript(
      [message(1, "user", "2026-11-12T00:00:00Z"), message(2, "assistant", "2026-11-12T00:00:09Z")],
      [note(4, "2026-11-12T00:00:05Z"), note(3, "2026-11-12T00:00:03Z")],
    );
    expect(
      entries.map((entry) =>
        entry.kind === "message"
          ? entry.message.content
          : entry.notes.map((item) => item.message).join(","),
      ),
    ).toEqual(["m1", "n3,n4", "m2"]);
  });

  it("시각이 같으면 대화가 먼저이고, 팀 기록끼리는 seq 순이다", () => {
    const at = "2026-11-12T00:00:01Z";
    const entries = mergeTranscript([message(1, "assistant", at)], [note(8, at), note(7, at)]);
    expect(entries[0]).toEqual({ kind: "message", message: message(1, "assistant", at) });
    expect(entries[1]).toEqual({ kind: "notes", notes: [note(7, at), note(8, at)] });
  });

  it("시간대 없는 DB 시각도 UTC 로 비교하고 대화 순서는 바꾸지 않는다", () => {
    const entries = mergeTranscript(
      [message(1, "user", "2026-11-12T00:00:10"), message(2, "assistant", "시각 없음")],
      [note(1, "2026-11-12T00:00:05Z")],
    );
    expect(entries.map((entry) => entry.kind)).toEqual(["notes", "message", "message"]);
    expect(
      entries.flatMap((entry) => (entry.kind === "message" ? [entry.message.id] : [])),
    ).toEqual([1, 2]);
  });

  it("시연 대본 전체를 섞으면 고객 요청, 정리 답, 팀 기록 10개, 마무리 답 순서다", () => {
    const events = buildMockEvents();
    const office = events.reduce(officeReducer, initialOfficeState());
    const entries = mergeTranscript(mockChatForOffice(office).messages, teamNotesForOffice(office));
    expect(entries.map((entry) => entry.kind)).toEqual(["message", "message", "notes", "message"]);
    const notes = entries[2].kind === "notes" ? entries[2].notes : [];
    expect(notes).toHaveLength(10);
    expect(notes.map((item) => item.seq)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("팀 기록이 없으면 대화만 그대로 돌려준다", () => {
    const messages = [message(1, "user", "2026-11-12T00:00:00Z")];
    expect(mergeTranscript(messages, [])).toEqual([{ kind: "message", message: messages[0] }]);
  });
});

describe("consoleDisplay", () => {
  it("실제 음성 단계가 대기가 아니면 그 단계가 우선한다", () => {
    expect(consoleDisplay("listening", "running", "")).toBe("listening");
    expect(consoleDisplay("speaking", "completed", "")).toBe("speaking");
    expect(consoleDisplay("error", "running", "예산")).toBe("error");
  });

  it("대기일 때는 받은 이벤트와 시연 받아쓰기에서 단계를 고른다", () => {
    expect(consoleDisplay("idle", "idle", "예산 250")).toBe("drafting");
    expect(consoleDisplay("idle", "pending", "")).toBe("working");
    expect(consoleDisplay("idle", "running", "")).toBe("working");
    expect(consoleDisplay("idle", "needs_input", "")).toBe("waiting");
    expect(consoleDisplay("idle", "completed", "")).toBe("done");
  });

  it("실행 상태가 없거나 멈췄으면 대기로 둔다", () => {
    expect(consoleDisplay("idle", undefined, "")).toBe("idle");
    expect(consoleDisplay("idle", "idle", "")).toBe("idle");
    expect(consoleDisplay("idle", "failed", "")).toBe("idle");
    expect(consoleDisplay("idle", "superseded", "")).toBe("idle");
  });

  it("시연 대본 각 단계에서 진행 중에는 작업 중, 끝나면 답변 준비됨이다", () => {
    const events = buildMockEvents();
    const states = events.map((_, index) =>
      events.slice(0, index + 1).reduce(officeReducer, initialOfficeState()),
    );
    for (const office of states.slice(0, -1)) {
      expect(consoleDisplay("idle", office.runStatus, "")).toBe("working");
    }
    expect(consoleDisplay("idle", states.at(-1)!.runStatus, "")).toBe("done");
  });
});
