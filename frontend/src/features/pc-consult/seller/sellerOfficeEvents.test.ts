import { describe, expect, it } from "vitest";
import { initialOfficeState, type OfficeState } from "../../office/officeState";
import { handoff, printOut } from "../../office/officeCues";
import { initialSellerState } from "./mockData";
import { sellerOfficeEvent } from "./sellerOfficeEvents";
import { sellerReducer, type SellerEvent } from "./sellerState";

// 기존 mockData의 가상 고객·이슈를 사용합니다. 실제 고객이나 부품 데이터가 아닙니다.
function scenario() {
  let state = initialSellerState();
  let office = initialOfficeState();
  function receive(event: SellerEvent) {
    const next = sellerReducer(state, event, "admin");
    office = sellerOfficeEvent(office, event, state, next, "2026-11-18T01:00:00Z");
    state = next;
    return office;
  }
  return { receive, state: () => state, office: () => office };
}

function expectNoPcCompletion(office: OfficeState) {
  // 설계·분석팀의 상담 요약과 검증팀의 클레임 분류는 실제 시연 업무입니다.
  // 모든 팀이 idle인지 대신, PC 견적을 만들거나 출력하지 않았는지 검사합니다.
  expect(office.teams.quotation.status).toBe("idle");
  expect(office.teams.quotation.log).toHaveLength(0);
  expect(office.runEvent?.type).not.toBe("run.completed");
  expect(printOut(office)).toBeNull();
}

describe("판매자 시연과 기존 게임 오피스 연결", () => {
  it("상담 문서가 분석팀으로 이동하고 요약 수신 뒤에만 인계 작업을 완료한다", () => {
    const demo = scenario();
    const id = "test-consultation";
    const started = demo.receive({
      type: "CONSULT_STARTED",
      id,
      customerId: demo.state().customers[0].id,
    });
    expect(started.teams.consultation.status).toBe("running");
    expect(demo.receive({ type: "SUMMARY_READY", consultationId: id })).toBe(started);
    demo.receive({ type: "HANDOFF_STARTED", consultationId: id });
    expect(demo.office().teams.consultation.status).toBe("completed");
    expect(demo.office().teams.design.status).toBe("running");
    expect(demo.office().teams.design.message).toContain("상담 요약과 인계 문서");
    expect(handoff(demo.office())).toEqual({
      from: "consultation",
      to: "design",
      seq: demo.office().lastSeq,
    });
    demo.receive({ type: "SUMMARY_READY", consultationId: id });
    expect(demo.office().teams.design.status).toBe("completed");
    expect(demo.office().teams.design.message).toContain("상담 요약");
    expect(demo.office().teams.validation.status).toBe("idle");
    expect(handoff(demo.office())).toBeNull();
    expectNoPcCompletion(demo.office());
  });

  it("클레임 처리 완료를 견적 완료로 표시하지 않는다", () => {
    const demo = scenario();
    const id = "test-claim";
    demo.receive({ type: "CLAIM_RECEIVED", id, customerId: demo.state().customers[0].id });
    expect(demo.office().teams.consultation.status).toBe("completed");
    expect(demo.office().teams.validation.status).toBe("running");
    expect(demo.office().teams.validation.message).toContain("클레임 유형과 담당 부서");
    expect(handoff(demo.office())).toEqual({
      from: "consultation",
      to: "validation",
      seq: demo.office().lastSeq,
    });
    demo.receive({ type: "CLAIM_CLASSIFIED", id });
    expect(demo.office().runStatus).toBe("needs_input");
    expect(demo.office().teams.validation.status).toBe("completed");
    expect(demo.office().teams.design.status).toBe("idle");
    demo.receive({ type: "ASSIGN_ISSUE", id, assignee: demo.state().employees[0].name });
    demo.receive({ type: "COMPLETE_ISSUE", id });
    expect(demo.office().teams.consultation.message).toContain("이슈 처리를 완료");
    expectNoPcCompletion(demo.office());
  });

  it("상담 인계 도중 다른 이슈를 처리해도 상담 오피스와 인계 결과를 유지한다", () => {
    const demo = scenario();
    const id = "test-handoff";
    demo.receive({ type: "SCENARIO_STARTED" });
    demo.receive({ type: "CONSULT_STARTED", id, customerId: demo.state().customers[0].id });
    demo.receive({ type: "HANDOFF_STARTED", consultationId: id });
    const office = demo.office();
    const issue = demo.state().issues.find((item) => item.stage !== "done")!;
    demo.receive({ type: "ASSIGN_ISSUE", id: issue.id, assignee: demo.state().employees[0].name });
    demo.receive({ type: "COMPLETE_ISSUE", id: issue.id });
    expect(demo.office()).toBe(office);
    demo.receive({ type: "SUMMARY_READY", consultationId: id });
    expect(demo.office().teams.design.message).toContain("요약");
  });

  it("초기화 후 오래된 상담 완료 이벤트는 오피스를 바꾸지 않는다", () => {
    const demo = scenario();
    demo.receive({ type: "CONSULT_STARTED", id: "old", customerId: demo.state().customers[0].id });
    demo.receive({ type: "RESET", companyCode: "BW-2002" });
    const reset = demo.office();
    expect(reset).toEqual(initialOfficeState());
    expect(demo.receive({ type: "SUMMARY_READY", consultationId: "old" })).toBe(reset);
  });
});
