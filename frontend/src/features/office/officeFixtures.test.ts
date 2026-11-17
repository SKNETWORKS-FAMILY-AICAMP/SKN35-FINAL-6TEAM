import { describe, expect, it } from "vitest";
import { validators } from "./officeCues";
import { OFFICE_FIXTURES, fixtureState } from "./officeFixtures";
import { TEAMS, type DisplayStatus } from "./officeState";

function state(id: string) {
  const found = OFFICE_FIXTURES.find((item) => item.id === id);
  if (!found) throw new Error(`견본이 없습니다: ${id}`);
  return fixtureState(found);
}

describe("사무실 상태 견본", () => {
  it("견본마다 이름이 다르고, 순번은 1부터 빈틈없이 늘어난다", () => {
    const ids = OFFICE_FIXTURES.map((fixture) => fixture.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const fixture of OFFICE_FIXTURES) {
      expect(fixture.title.length).toBeGreaterThan(0);
      fixture.events.forEach((event, index) => expect(event.seq).toBe(index + 1));
    }
  });

  it("받은 이벤트를 모두 반영한다(버린 이벤트가 없다)", () => {
    for (const fixture of OFFICE_FIXTURES) {
      expect(fixtureState(fixture).lastSeq).toBe(fixture.events.length);
    }
  });

  it.each<[string, DisplayStatus, Partial<Record<(typeof TEAMS)[number], DisplayStatus>>]>([
    [
      "idle",
      "idle",
      { consultation: "idle", design: "idle", validation: "idle", quotation: "idle" },
    ],
    ["design", "running", { consultation: "completed", design: "running", validation: "idle" }],
    ["validation-parallel", "running", { design: "running", validation: "running" }],
    ["needs-input", "needs_input", { consultation: "needs_input", design: "needs_input" }],
    ["needs-revision", "needs_revision", { design: "needs_revision", validation: "completed" }],
    ["retrying", "running", { quotation: "running" }],
    ["failed-retryable", "failed", { quotation: "failed" }],
    ["failed-final", "failed", { quotation: "failed" }],
    ["superseded", "superseded", { design: "running", validation: "running" }],
    ["cancelled", "cancelled", { design: "running", validation: "cancelled" }],
    ["long-message", "running", { design: "running", validation: "running", quotation: "idle" }],
    [
      "completed",
      "completed",
      {
        consultation: "completed",
        design: "completed",
        validation: "completed",
        quotation: "completed",
      },
    ],
  ])("%s 견본은 실행 %s 와 팀 상태를 만든다", (id, runStatus, teams) => {
    const current = state(id);
    expect(current.runStatus).toBe(runStatus);
    for (const [team, status] of Object.entries(teams)) {
      expect(current.teams[team as (typeof TEAMS)[number]].status).toBe(status);
    }
  });

  it("검증 2건 동시 견본은 검증원 두 명을 앉힌다", () => {
    expect(validators(state("validation-parallel"))).toEqual({ count: 2, overflow: 0 });
  });

  it("실패 견본은 다시 시도 가능 여부만 다르다", () => {
    expect(state("failed-retryable").runError).toMatchObject({
      code: "PRICE_UNCONFIRMED",
      retryable: true,
    });
    expect(state("failed-final").runError?.retryable).toBe(false);
  });

  it("아주 긴 메시지 견본은 실제로 긴 문장을 담는다", () => {
    const current = state("long-message");
    expect(current.teams.consultation.message.length).toBeGreaterThan(60);
    expect(current.teams.validation.message.length).toBeGreaterThan(60);
  });
});
