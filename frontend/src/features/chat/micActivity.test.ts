import { describe, expect, it } from "vitest";
import { createEnergyGate, rmsToDb, type GateEvent } from "./micActivity";

const FRAME = 25;

/** 시각 from 부터 to 까지 25ms 마다 프레임을 넣고 나온 사건을 시각과 함께 모읍니다. */
function run(
  gate: ReturnType<typeof createEnergyGate>,
  from: number,
  to: number,
  db: (at: number) => number,
  speaking: (at: number) => { speaking: boolean; utteranceStartedAt: number | null } = () => ({
    speaking: false,
    utteranceStartedAt: null,
  }),
) {
  const events: { at: number; event: GateEvent }[] = [];
  for (let at = from; at < to; at += FRAME) {
    const event = gate.update({ at, db: db(at), ...speaking(at) });
    if (event) events.push({ at, event });
  }
  return events;
}

describe("rmsToDb", () => {
  it("measures full scale and silence", () => {
    expect(rmsToDb([1, -1, 1, -1])).toBeCloseTo(0, 5);
    expect(rmsToDb(new Float32Array(16))).toBeLessThan(-150);
  });
});

describe("createEnergyGate", () => {
  it("learns the room during warm-up and catches sustained speech, then releases", () => {
    const gate = createEnergyGate();
    expect(run(gate, 0, 1000, () => -60)).toEqual([]);
    const events = run(gate, 1000, 2000, (at) => (at < 1500 ? -20 : -60));
    expect(events.map((item) => item.event)).toEqual(["start", "end"]);
    expect(events[0].at).toBeGreaterThanOrEqual(1250);
    expect(events[0].at).toBeLessThan(1400);
  });

  it("ignores a short click", () => {
    const gate = createEnergyGate();
    run(gate, 0, 1000, () => -60);
    expect(run(gate, 1000, 2000, (at) => (at >= 1200 && at < 1350 ? -10 : -60))).toEqual([]);
  });

  it("does not fire during warm-up even when it is loud", () => {
    const gate = createEnergyGate();
    expect(run(gate, 0, 450, () => -10)).toEqual([]);
  });

  it("treats our own voice coming back as echo, but still hears the user over it", () => {
    const gate = createEnergyGate();
    run(gate, 0, 1000, () => -60);
    const echo = (at: number) => ({ speaking: true, utteranceStartedAt: at < 3000 ? 1000 : 3000 });
    // 우리 목소리가 -35dB 로 되돌아옵니다. 문장 시작 직후에 바닥값을 배우므로 혼자서는 걸리지 않습니다.
    expect(run(gate, 1000, 3000, () => -35, echo)).toEqual([]);
    // 사용자가 그 위로 크게 말하면 걸립니다.
    const events = run(gate, 3000, 4500, (at) => (at >= 3600 ? -12 : -35), echo);
    expect(events[0]?.event).toBe("start");
    expect(events[0].at).toBeGreaterThanOrEqual(3600);
  });

  it("ignores the first moment of each sentence", () => {
    const gate = createEnergyGate();
    run(gate, 0, 1000, () => -60);
    const events = run(
      gate,
      1000,
      1300,
      () => -10,
      () => ({ speaking: true, utteranceStartedAt: 1000 }),
    );
    expect(events).toEqual([]);
  });
});
