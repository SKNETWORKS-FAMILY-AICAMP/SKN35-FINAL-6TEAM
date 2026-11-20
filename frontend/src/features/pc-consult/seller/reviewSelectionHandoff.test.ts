import { describe, expect, it } from "vitest";
import { fixtureParts } from "../fixtures/snapshot.fixture";
import { createReviewSelectionStore, type ReviewSelection } from "../reviewSelectionStore";
import { initialSellerRuntime, sellerRuntimeReducer, type SellerRuntime } from "./operations";
import { reviewSelectionHandoff } from "./reviewSelectionHandoff";
import type { SellerEvent } from "./sellerState";

// Product identity comes from the unchanged snapshot fixture; reasons are synthetic event test inputs.
function selection(index = 0, companyCode = "BW-1001"): ReviewSelection {
  const part = fixtureParts[index];
  return {
    key: JSON.stringify([companyCode, "review-browser-test", part.category, part.source_key]),
    companyCode,
    consultationId: "review-browser-test",
    category: part.category,
    sourceKey: part.source_key,
    productName: part.name,
    reasons: ["호환성 근거를 확인해야 합니다."],
    selectedAt: "2026-11-20T02:00:00Z",
  };
}
function send(runtime: SellerRuntime, event: SellerEvent) {
  return sellerRuntimeReducer(runtime, event, "admin", "2026-11-20T02:00:00Z");
}
function sync(runtime: SellerRuntime, record: ReviewSelection) {
  return send(runtime, { type: "PREVIEW_HANDOFF", input: reviewSelectionHandoff(record) });
}

describe("실제 시연 선택의 기업 피드백·인계 연결", () => {
  it("creates a pending handoff with real product names and UNKNOWN reasons without adding to mock KPIs", () => {
    const initial = initialSellerRuntime("BW-1001");
    const record = selection();
    const next = sync(initial, record);
    const issue = next.state.issues[0];
    expect(issue.dataOrigin).toBe("browser-selection");
    expect(issue.title).toBe("상품 정보 보강 필요");
    expect(issue.stage).toBe("received");
    expect(issue.customerId).toBe("browser-consultation");
    expect(issue.reasons?.[0]).toContain(record.productName);
    expect(issue.reasons?.[0]).toContain(record.reasons[0]);
    expect(issue.reviewSelections?.[0].sourceKey).toBe(record.sourceKey);
    expect(next.performance).toBe(initial.performance);
    expect(next.state.todayConsultations).toBe(initial.state.todayConsultations);
    expect(next.state.completedConsultations).toBe(initial.state.completedConsultations);
    expect(next.office.runStatus).toBe("needs_input");
    expect(next.events.at(-1)?.type).toBe("run.needs_input");
    expect(next.events.filter((event) => event.type === "run.completed")).toHaveLength(0);
  });

  it("aggregates multiple selected products into one consultation handoff and ignores repeated menu/rerender receipts", () => {
    const first = selection();
    const second = selection(1);
    let current = sync(sync(initialSellerRuntime("BW-1001"), first), second);
    expect(current.state.issues.filter((issue) => issue.dataOrigin)).toHaveLength(1);
    expect(current.state.issues[0].reviewSelections).toHaveLength(2);
    for (const menu of ["feedback", "issues", "home", "feedback"] as const) {
      current = send(current, { type: "NAVIGATE", menu });
      const before = current;
      current = sync(sync(current, first), second);
      expect(current.state.issues).toBe(before.state.issues);
      expect(current.events).toBe(before.events);
    }
  });

  it("merges preview forwarding and automatic selected-product reporting in either order", () => {
    const record = selection();
    const input = {
      ...reviewSelectionHandoff(record),
      dataOrigin: "browser-preview" as const,
      reviewSelections: undefined,
      reasons: ["할인 요청 확인"],
      messages: [{ speaker: "고객", text: "할인 요청이 있습니다." }],
    };
    for (const previewFirst of [true, false]) {
      let current = initialSellerRuntime("BW-1001");
      if (previewFirst) current = send(current, { type: "PREVIEW_HANDOFF", input });
      current = sync(current, record);
      current = send(current, { type: "PREVIEW_HANDOFF", input });
      const only = current.state.issues.filter((issue) => issue.dataOrigin);
      expect(only).toHaveLength(1);
      expect(only[0].reviewSelections).toHaveLength(1);
      expect(only[0].reasons).toContain("할인 요청 확인");
      expect(only[0].lines?.some((line) => line.text === "할인 요청이 있습니다.")).toBe(true);
      const repeated = send(current, { type: "PREVIEW_HANDOFF", input });
      expect(repeated.state.issues).toBe(current.state.issues);
      expect(repeated.events).toBe(current.events);
    }
  });

  it("restores retained history after account re-entry, isolates companies and resets only the selected company", () => {
    const store = createReviewSelectionStore();
    store.dispatch({ type: "SELECTED", selection: selection() });
    store.dispatch({ type: "SELECTED", selection: selection(1, "BW-2002") });
    const enter = (companyCode: string) =>
      store
        .getSnapshot()
        .filter((record) => record.companyCode === companyCode)
        .reduce(sync, initialSellerRuntime(companyCode));
    expect(enter("BW-1001").state.issues[0].reviewSelections?.[0].sourceKey).toBe(
      selection().sourceKey,
    );
    expect(enter("BW-2002").state.issues[0].reviewSelections?.[0].sourceKey).toBe(
      selection(1, "BW-2002").sourceKey,
    );
    expect(enter("BW-1001").state.issues.filter((issue) => issue.dataOrigin)).toHaveLength(1);
    store.dispatch({ type: "RESET_COMPANY", companyCode: "BW-1001" });
    expect(enter("BW-1001").state.issues.every((issue) => !issue.dataOrigin)).toBe(true);
    expect(enter("BW-2002").state.issues.filter((issue) => issue.dataOrigin)).toHaveLength(1);
  });

  it("does not reopen handled work for a duplicate receipt, but flags a newly selected product for review", () => {
    let current = sync(initialSellerRuntime("BW-1001"), selection());
    const id = current.state.issues[0].id;
    current = send(current, {
      type: "ASSIGN_ISSUE",
      id,
      assignee: current.state.employees[1].name,
    });
    current = send(current, { type: "COMPLETE_ISSUE", id });
    expect(sync(current, selection()).state.issues[0].stage).toBe("done");
    expect(sync(current, selection(1)).state.issues[0].stage).toBe("received");
  });
});
