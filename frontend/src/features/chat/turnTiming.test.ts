import { describe, expect, it } from "vitest";
import { TurnTimer, intervalValues, percentile, summarize } from "./turnTiming";

describe("percentile", () => {
  it("uses nearest rank and handles empty and single values", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([7], 90)).toBe(7);
    expect(percentile([5, 1, 4, 2, 3], 50)).toBe(3);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
  });
});

describe("TurnTimer", () => {
  it("keeps only the first value of each mark and the first begin of a turn", () => {
    const timer = new TurnTimer();
    timer.begin(1, "voice", { speechEnd: 100, endpoint: 650 }, { rule: "final", delayMs: 550 });
    timer.begin(1, "text", { endpoint: 9999 });
    timer.mark(1, "firstAudio", 900);
    timer.mark(1, "firstAudio", 1200);
    timer.mark(2, "firstAudio", 1);
    const [record] = timer.snapshot();
    expect(record).toMatchObject({
      turnId: 1,
      source: "voice",
      endpointRule: "final",
      endpointDelayMs: 550,
      marks: { speechEnd: 100, endpoint: 650, firstAudio: 900 },
    });
    expect(timer.snapshot()).toHaveLength(1);
  });

  it("drops the oldest turns past the limit", () => {
    const timer = new TurnTimer(3);
    for (let turn = 1; turn <= 5; turn++) timer.begin(turn, "voice");
    expect(timer.snapshot().map((record) => record.turnId)).toEqual([3, 4, 5]);
  });

  it("summarizes intervals and skips turns with missing marks", () => {
    const timer = new TurnTimer();
    timer.begin(1, "voice", { speechEnd: 0, endpoint: 550 });
    timer.mark(1, "requestSent", 560);
    timer.mark(1, "firstAudio", 900);
    timer.mark(1, "firstReply", 2500);
    timer.mark(1, "firstContentAudio", 2600);
    timer.gap(1, 120);
    timer.gap(1, 80);
    timer.begin(2, "text");
    timer.mark(2, "requestSent", 0);
    timer.mark(2, "firstReply", 300);
    const records = timer.snapshot();
    expect(intervalValues(records, "endpointWait")).toEqual([550]);
    expect(intervalValues(records, "firstAudio")).toEqual([350]);
    expect(intervalValues(records, "firstContent")).toEqual([2050]);
    expect(intervalValues(records, "server")).toEqual([1940, 300]);
    expect(intervalValues(records, "gap")).toEqual([120, 80]);
    const server = summarize(records).find((row) => row.key === "server");
    expect(server).toMatchObject({ n: 2, p50: 300, p90: 1940 });
  });

  it("notifies subscribers and returns a stable snapshot until something changes", () => {
    const timer = new TurnTimer();
    let calls = 0;
    const unsubscribe = timer.subscribe(() => calls++);
    const before = timer.snapshot();
    expect(timer.snapshot()).toBe(before);
    timer.begin(1, "voice");
    timer.flag(1, "ack");
    timer.flag(1, "ack");
    expect(calls).toBe(2);
    expect(timer.snapshot()).not.toBe(before);
    unsubscribe();
    timer.clear();
    expect(calls).toBe(2);
    expect(timer.snapshot()).toEqual([]);
  });

  it("counts reading paths and summarizes server voice fetch time", () => {
    const timer = new TurnTimer();
    timer.begin(1, "voice");
    timer.read(1, { path: "server", fetchMs: 420.4 });
    timer.read(1, { path: "server", fetchMs: 180 });
    timer.read(1, { path: "browser", fallback: true });
    timer.read(1, undefined);
    timer.read(9, { path: "server", fetchMs: 1 });
    expect(timer.snapshot()[0].reading).toEqual({
      server: 2,
      browser: 2,
      fallback: 1,
      fetchMs: [420, 180],
    });
    expect(intervalValues(timer.snapshot(), "speechFetch")).toEqual([420, 180]);
  });

  it("exports relative times and no transcript text", () => {
    const timer = new TurnTimer();
    timer.begin(1, "voice", { speechStart: 1_700_000_000_000, endpoint: 1_700_000_000_800 });
    timer.mark(1, "firstAudio", 1_700_000_001_100);
    const parsed = JSON.parse(timer.exportJson({ note: "lab" }));
    expect(parsed.format).toBe("buildwise-voice-timing/1");
    expect(parsed.meta).toEqual({ note: "lab" });
    expect(parsed.turns[0].marks).toEqual({ speechStart: 0, endpoint: 800, firstAudio: 1100 });
    expect(Object.keys(parsed.turns[0]).sort()).toEqual(
      [
        "ack",
        "bargeIn",
        "endpointDelayMs",
        "endpointRule",
        "marks",
        "reading",
        "sentenceGapsMs",
        "source",
        "turnId",
      ].sort(),
    );
  });
});
