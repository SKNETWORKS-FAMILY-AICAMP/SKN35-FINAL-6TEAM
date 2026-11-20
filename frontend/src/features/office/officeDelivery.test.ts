import { describe, expect, it } from "vitest";
import { buildMockEvents } from "../../events/mockEventStream";
import { handoff } from "./officeCues";
import { deliveryVisualReducer, initialDeliveryVisual } from "./officeDelivery";
import { initialOfficeState, officeReducer } from "./officeState";

const scope = "1:mock-run";
const events = buildMockEvents();
const first = handoff(events.slice(0, 3).reduce(officeReducer, initialOfficeState()))!;
const second = handoff(events.slice(0, 11).reduce(officeReducer, initialOfficeState()))!;
const observe = (cue: typeof first | null, overrides = {}) => ({
  type: "observe" as const,
  scope,
  cue,
  stopped: false,
  reduced: false,
  ...overrides,
});

describe("이벤트 기반 서류 전달 연출", () => {
  it("실제 handoff가 없는 진행 기록에서 전달 직원을 만들지 않는다", () => {
    const empty = initialDeliveryVisual(scope, null);
    expect(deliveryVisualReducer(empty, observe(null))).toBe(empty);
  });

  it("다음 진행 이벤트가 와도 이미 시작한 전달은 끝까지 보인다", () => {
    const started = initialDeliveryVisual(scope, first);
    const progress = handoff(events.slice(0, 4).reduce(officeReducer, initialOfficeState()));
    expect(progress).toBeNull();
    expect(deliveryVisualReducer(started, observe(progress)).current).toEqual(first);
  });

  it("같은 순번을 재수신해도 다시 달리지 않고 실제 다음 인계만 순서대로 보여준다", () => {
    const started = initialDeliveryVisual(scope, first);
    expect(deliveryVisualReducer(started, observe(first))).toBe(started);
    const queued = deliveryVisualReducer(started, observe(second));
    expect(queued.current).toEqual(first);
    expect(queued.pending).toEqual([second]);
    const next = deliveryVisualReducer(queued, { type: "arrived", scope, seq: first.seq });
    expect(next.current).toEqual(second);
    const done = deliveryVisualReducer(next, { type: "arrived", scope, seq: second.seq });
    expect(done.current).toBeNull();
    expect(deliveryVisualReducer(done, observe(second))).toBe(done);
  });

  it("버전 또는 실행이 바뀌면 이전 인계와 늦은 도착 콜백을 버린다", () => {
    const started = initialDeliveryVisual(scope, first);
    const changed = deliveryVisualReducer(started, observe(null, { scope: "2:new-run" }));
    expect(changed.current).toBeNull();
    expect(changed.pending).toEqual([]);
    expect(deliveryVisualReducer(changed, { type: "arrived", scope, seq: first.seq })).toBe(
      changed,
    );
  });

  it("실행 중단 또는 움직임 줄이기에서는 뛰는 연출을 지운다", () => {
    const started = initialDeliveryVisual(scope, first);
    for (const option of [{ stopped: true }, { reduced: true }]) {
      const stopped = deliveryVisualReducer(started, observe(first, option));
      expect(stopped.current).toBeNull();
      expect(stopped.pending).toEqual([]);
      expect(deliveryVisualReducer(stopped, observe(first))).toBe(stopped);
    }
  });

  it("도착 애니메이션은 실제 사무실 상태나 업무 이벤트를 변경하지 않는다", () => {
    const office = events.slice(0, 3).reduce(officeReducer, initialOfficeState());
    const before = JSON.stringify(office);
    deliveryVisualReducer(initialDeliveryVisual(scope, first), {
      type: "arrived",
      scope,
      seq: first.seq,
    });
    expect(JSON.stringify(office)).toBe(before);
    expect(office.runStatus).toBe("running");
    expect(office.teams.design.status).toBe("running");
  });
});
