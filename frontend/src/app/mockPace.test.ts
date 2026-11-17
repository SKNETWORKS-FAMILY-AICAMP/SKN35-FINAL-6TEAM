import { describe, expect, it, vi } from "vitest";
import { buildMockEvents, createMockEventStream } from "../events/mockEventStream";
import { mockIntervalFromSearch } from "./mockPace";

describe("mockIntervalFromSearch", () => {
  it("pace 가 없으면 기본 700ms", () => {
    expect(mockIntervalFromSearch("")).toBe(700);
    expect(mockIntervalFromSearch("?mock=1")).toBe(700);
    expect(mockIntervalFromSearch("?mock=1&pace=")).toBe(700);
  });

  it("pace=slow 는 2000ms", () => {
    expect(mockIntervalFromSearch("?mock=1&pace=slow")).toBe(2000);
  });

  it("숫자는 300~5000ms 안으로 맞춘다", () => {
    expect(mockIntervalFromSearch("?mock=1&pace=1200")).toBe(1200);
    expect(mockIntervalFromSearch("?pace=0")).toBe(300);
    expect(mockIntervalFromSearch("?pace=-50")).toBe(300);
    expect(mockIntervalFromSearch("?pace=99999")).toBe(5000);
    expect(mockIntervalFromSearch("?pace=850.6")).toBe(851);
  });

  it("알 수 없는 값은 기본값으로 둔다", () => {
    expect(mockIntervalFromSearch("?pace=fast")).toBe(700);
    expect(mockIntervalFromSearch("?pace=Infinity")).toBe(700);
  });
});

describe("시연 재생 간격과 기록 시각", () => {
  it("기록 시각 간격이 재생 간격과 같다", () => {
    for (const interval of [700, 2000]) {
      const events = buildMockEvents("mock-session", 0, interval);
      for (let index = 1; index < events.length; index += 1) {
        const gap =
          Date.parse(events[index].occurred_at) - Date.parse(events[index - 1].occurred_at);
        expect(gap).toBe(interval);
      }
    }
  });

  it("간격을 주지 않으면 700ms 로 기록한다", () => {
    const events = buildMockEvents();
    expect(Date.parse(events[1].occurred_at) - Date.parse(events[0].occurred_at)).toBe(700);
  });

  it("스트림이 받은 간격으로 이벤트를 하나씩 보낸다", () => {
    vi.useFakeTimers();
    try {
      const received: number[] = [];
      const unsubscribe = createMockEventStream(2000).subscribe(
        (event) => received.push(event.seq),
        () => undefined,
      );
      vi.advanceTimersByTime(1999);
      expect(received).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(received).toEqual([1]);
      vi.advanceTimersByTime(4000);
      expect(received).toEqual([1, 2, 3]);
      unsubscribe();
    } finally {
      vi.useRealTimers();
    }
  });
});
