import { describe, expect, it } from "vitest";
import { buildMockEvents } from "../../events/mockEventStream";
import { initialOfficeState, officeReducer } from "../office/officeState";
import { conditionTags } from "./transcript";
import { MOCK_CUSTOMER_TEXT, mockChatForOffice } from "./mockTranscript";

describe("mockChatForOffice", () => {
  it("수신한 이벤트가 없으면 확정 대사를 표시하지 않는다", () => {
    expect(mockChatForOffice(initialOfficeState())).toEqual({
      messages: [],
      pending: null,
      error: null,
    });
  });

  it("실제 mock 이벤트의 각 수신 단계에서 미래 작업·견적을 미리 표시하지 않는다", () => {
    const events = buildMockEvents();
    for (let count = 1; count <= events.length; count += 1) {
      const received = events.slice(0, count);
      const office = received.reduce(officeReducer, initialOfficeState());
      const chat = mockChatForOffice(office);
      const expected = received.filter((event) => event.team !== null);
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
