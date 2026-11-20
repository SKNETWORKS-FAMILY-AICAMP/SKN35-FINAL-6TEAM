import { describe, expect, it } from "vitest";
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
