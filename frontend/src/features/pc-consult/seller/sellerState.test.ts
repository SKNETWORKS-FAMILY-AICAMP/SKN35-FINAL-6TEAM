import { afterEach, describe, expect, it, vi } from "vitest";
import { DEMO_COMPANIES, DEMO_SCRIPT, initialSellerState } from "./mockData";
import { activeAbuseCount, pendingIssueCount, sellerReducer } from "./sellerState";
import { scheduleDemoScenario } from "./useSellerDemo";
import type { SellerEvent } from "./sellerState";

afterEach(() => vi.useRealTimers());

describe("seller demonstration state", () => {
  it("creates isolated companies with the requested synthetic data counts and valid quote totals", () => {
    const first = initialSellerState(DEMO_COMPANIES[0].code);
    const second = initialSellerState(DEMO_COMPANIES[1].code);
    expect(first.customers).toHaveLength(20);
    expect(first.customers.filter((customer) => customer.blocked)).toHaveLength(2);
    expect(first.quotes).toHaveLength(30);
    expect(first.consultations).toHaveLength(40);
    expect(first.issues).toHaveLength(8);
    expect(first.employees).toHaveLength(5);
    expect(first.employees.filter((employee) => employee.status === "pending")).toHaveLength(1);
    expect(first.employees.filter((employee) => employee.role === "admin")).toHaveLength(1);
    expect(first.todaySales).toBe(first.parts.reduce((sum, part) => sum + part.sales, 0));
    expect(first.documents.map((document) => document.kind)).toEqual(
      expect.arrayContaining(["공지", "FAQ", "AS 정책"]),
    );
    expect(new Set(first.issues.map((issue) => issue.stage)).size).toBe(4);
    expect(
      first.quotes.every(
        (quote) =>
          quote.total === quote.items.reduce((sum, item) => sum + item.price * item.quantity, 0),
      ),
    ).toBe(true);
    expect(second.customers[0].id).not.toBe(first.customers[0].id);
    first.customers[0].name = "시연 수정";
    expect(initialSellerState().customers[0].name).not.toBe(first.customers[0].name);
  });

  it("denies protected menus and changes to staff at the reducer boundary", () => {
    const initial = initialSellerState();
    for (const menu of ["sales", "documents", "employees"] as const) {
      const denied = sellerReducer(initial, { type: "NAVIGATE", menu }, "agent");
      expect(denied.menu).toBe("home");
      expect(denied.toast).toContain("관리자");
    }
    const blocked = sellerReducer(
      initial,
      {
        type: "SET_BLOCK",
        customerId: initial.customers[0].id,
        blocked: true,
        reason: "시연 사유",
      },
      "agent",
    );
    expect(blocked.customers).toBe(initial.customers);
    expect(blocked.toast).toContain("검토");
    const policy = sellerReducer(
      initial,
      { type: "SAVE_POLICY", shippingFee: 0, discount: 99 },
      "agent",
    );
    expect(policy.discount).toBe(initial.discount);
    const approved = sellerReducer(
      initial,
      { type: "APPROVE_EMPLOYEE", id: initial.employees[4].id },
      "agent",
    );
    expect(approved.employees[4].status).toBe("pending");
    const upload = sellerReducer(initial, { type: "UPLOAD_STARTED" }, "agent");
    expect(upload.uploadProgress).toBeNull();
  });

  it("reflects consultation and delayed handoff into counts, office, customer records, and unread menus", () => {
    const initial = initialSellerState();
    const id = "synthetic-new-chat";
    let state = sellerReducer(initial, {
      type: "CONSULT_STARTED",
      id,
      customerId: initial.customers[0].id,
    });
    expect(state.todayConsultations).toBe(initial.todayConsultations + 1);
    expect(state.activeConsultations).toBe(initial.activeConsultations + 1);
    expect(state.consultations[0].summary).toBeNull();
    expect(state.office.phase).toBe("talking");
    expect(state.unread).toContain("customers");
    expect(state.unread).not.toContain("home");
    const premature = sellerReducer(state, { type: "SUMMARY_READY", consultationId: id });
    expect(premature).toBe(state);
    state = sellerReducer(state, { type: "HANDOFF_STARTED", consultationId: id });
    expect(state.office.phase).toBe("handoff");
    expect(state.consultations[0].summary).toBeNull();
    state = sellerReducer(state, { type: "SUMMARY_READY", consultationId: id });
    expect(state.consultations[0].summary).toEqual(DEMO_SCRIPT.summary);
    expect(state.activeConsultations).toBe(initial.activeConsultations);
    expect(state.completedConsultations).toBe(initial.completedConsultations + 1);
    expect(state.todayConsultations).toBe(
      state.activeConsultations + state.waitingConsultations + state.completedConsultations,
    );
    expect(sellerReducer(state, { type: "SUMMARY_READY", consultationId: id })).toBe(state);
    const viewed = sellerReducer(state, { type: "NAVIGATE", menu: "customers" });
    expect(viewed.unread).not.toContain("customers");
    expect(viewed.consultations[0].summary).not.toBeNull();
  });

  it("moves claims through received, classified, assigned and done, including staff actions", () => {
    const initial = initialSellerState();
    let state = sellerReducer(initial, {
      type: "CLAIM_RECEIVED",
      id: "synthetic-issue",
      customerId: initial.customers[0].id,
    });
    expect(state.issues[0].stage).toBe("received");
    expect(pendingIssueCount(state)).toBe(pendingIssueCount(initial) + 1);
    state = sellerReducer(state, { type: "CLAIM_CLASSIFIED", id: "synthetic-issue" });
    expect(state.issues[0].stage).toBe("classified");
    const early = sellerReducer(state, { type: "COMPLETE_ISSUE", id: "synthetic-issue" }, "agent");
    expect(early.issues[0].stage).toBe("classified");
    state = sellerReducer(
      state,
      { type: "ASSIGN_ISSUE", id: "synthetic-issue", assignee: initial.employees[1].name },
      "agent",
    );
    expect(state.issues[0].stage).toBe("working");
    expect(state.office.phase).toBe("working");
    expect(
      sellerReducer(state, { type: "CLAIM_CLASSIFIED", id: "synthetic-issue" }).issues[0].stage,
    ).toBe("working");
    state = sellerReducer(state, { type: "COMPLETE_ISSUE", id: "synthetic-issue" }, "agent");
    expect(state.office.phase).toBe("done");
    expect(pendingIssueCount(state)).toBe(pendingIssueCount(initial));
  });

  it("allows manual issue work without losing an in-flight consultation summary", () => {
    const initial = initialSellerState();
    const issueId = initial.issues[0].id;
    const consultationId = "synthetic-concurrent-chat";
    let state = sellerReducer(initial, { type: "SCENARIO_STARTED" });
    state = sellerReducer(state, {
      type: "CONSULT_STARTED",
      id: consultationId,
      customerId: initial.customers[0].id,
    });
    const talkingOffice = state.office;
    state = sellerReducer(
      state,
      { type: "ASSIGN_ISSUE", id: issueId, assignee: initial.employees[1].name },
      "agent",
    );
    expect(state.issues.find((issue) => issue.id === issueId)?.stage).toBe("working");
    expect(state.feed[0].text).toContain("배정");
    expect(state.office).toBe(talkingOffice);
    state = sellerReducer(state, { type: "HANDOFF_STARTED", consultationId });
    const handoffOffice = state.office;
    state = sellerReducer(state, { type: "COMPLETE_ISSUE", id: issueId }, "agent");
    expect(state.issues.find((issue) => issue.id === issueId)?.stage).toBe("done");
    expect(state.feed[0].text).toContain("완료");
    expect(state.office).toBe(handoffOffice);
    state = sellerReducer(state, { type: "SUMMARY_READY", consultationId });
    expect(state.consultations[0].summary).toEqual(DEMO_SCRIPT.summary);
    expect(state.completedConsultations).toBe(initial.completedConsultations + 1);
    expect(state.issues.find((issue) => issue.id === issueId)?.stage).toBe("done");
    state = sellerReducer(state, { type: "SCENARIO_FINISHED" });
    state = sellerReducer(
      state,
      { type: "ASSIGN_ISSUE", id: initial.issues[1].id, assignee: initial.employees[1].name },
      "agent",
    );
    expect(state.office.phase).toBe("working");
  });

  it("shows masked alerts, allows staff to ignore, and reserves customer blocking for admins", () => {
    const initial = initialSellerState();
    const customerId = initial.customers[0].id;
    let state = sellerReducer(initial, {
      type: "ABUSE_DETECTED",
      id: "synthetic-alert",
      customerId,
    });
    expect(state.alerts[0].text).toContain("***");
    expect(activeAbuseCount(state)).toBe(1);
    const ignored = sellerReducer(state, { type: "IGNORE_ALERT", id: "synthetic-alert" }, "agent");
    expect(activeAbuseCount(ignored)).toBe(0);
    expect(ignored.customers[0].blocked).toBe(false);
    state = sellerReducer(
      state,
      { type: "SET_BLOCK", customerId, blocked: true, reason: "시연 상담 방해" },
      "admin",
    );
    expect(state.customers[0].blocked).toBe(true);
    expect(state.customers[0].blockReason).toBe("시연 상담 방해");
    expect(state.customers[0].blockedBy).toBeTruthy();
    expect(state.customers[0].blockedAt).toBeTruthy();
    expect(activeAbuseCount(state)).toBe(0);
    state = sellerReducer(state, { type: "SET_BLOCK", customerId, blocked: false }, "admin");
    expect(state.customers[0].blocked).toBe(false);
  });

  it("updates a completed sale once across sale counts, parts, quote history and unread indicators", () => {
    const initial = initialSellerState();
    const event: SellerEvent = {
      type: "SALE_COMPLETED",
      id: "synthetic-sale",
      partId: initial.parts[0].id,
      customerId: initial.customers[0].id,
    };
    const next = sellerReducer(initial, event);
    expect(next.todaySales).toBe(initial.todaySales + 1);
    expect(next.todaySales).toBe(next.parts.reduce((sum, part) => sum + part.sales, 0));
    expect(next.parts[0].sales).toBe(initial.parts[0].sales + 1);
    expect(next.quotes).toHaveLength(initial.quotes.length + 1);
    expect(next.quotes[0].total).toBe(initial.parts[0].price);
    expect(next.unread).toContain("sales");
    expect(sellerReducer(next, event)).toBe(next);
  });

  it("approves employees and validates admin policy updates", () => {
    const initial = initialSellerState();
    const approved = sellerReducer(
      initial,
      { type: "APPROVE_EMPLOYEE", id: initial.employees[4].id },
      "admin",
    );
    expect(approved.employees[4].status).toBe("active");
    const elevated = sellerReducer(
      approved,
      { type: "SET_EMPLOYEE_ROLE", id: initial.employees[4].id, role: "admin" },
      "admin",
    );
    expect(elevated.employees[4].role).toBe("admin");
    const deactivated = sellerReducer(
      elevated,
      { type: "SET_EMPLOYEE_STATUS", id: initial.employees[1].id, status: "inactive" },
      "admin",
    );
    expect(deactivated.employees[1].status).toBe("inactive");
    const invalid = sellerReducer(
      initial,
      { type: "SAVE_POLICY", shippingFee: -1, discount: 120 },
      "admin",
    );
    expect(invalid.shippingFee).toBe(initial.shippingFee);
    const saved = sellerReducer(
      initial,
      { type: "SAVE_POLICY", shippingFee: 0, discount: 10 },
      "admin",
    );
    expect(saved.discount).toBe(10);
    expect(saved.toast).toContain("견적에 반영");
    expect(saved.toast).toContain("시연");
  });

  it("never marks a document reflected before an explicit upload completion", () => {
    let state = initialSellerState();
    const initialCount = state.documents.length;
    state = sellerReducer(state, { type: "UPLOAD_STARTED" }, "admin");
    state = sellerReducer(state, { type: "UPLOAD_PROGRESS", progress: 75 }, "admin");
    expect(state.uploadProgress).toBe(75);
    expect(state.documents).toHaveLength(initialCount);
    state = sellerReducer(
      state,
      { type: "UPLOAD_COMPLETED", id: "synthetic-file", title: "시연 추가 문서.pdf", kind: "정책" },
      "admin",
    );
    expect(state.uploadProgress).toBeNull();
    expect(state.documents[0].reflected).toBe(true);
    expect(state.documents).toHaveLength(initialCount + 1);
  });

  it("uses a thirty-second ordered event script with real intermediate states", () => {
    vi.useFakeTimers();
    let state = initialSellerState();
    const initial = state;
    scheduleDemoScenario(
      "auto",
      {
        prefix: "synthetic-auto",
        customerId: state.customers[0].id,
        consultationId: state.consultations[0].id,
        partId: state.parts[0].id,
      },
      (event) => {
        state = sellerReducer(state, event);
      },
    );
    expect(state.scenarioRunning).toBe(true);
    vi.advanceTimersByTime(1200);
    expect(state.office.phase).toBe("talking");
    expect(state.consultations[0].lines).toHaveLength(3);
    vi.advanceTimersByTime(5800);
    expect(state.office.phase).toBe("handoff");
    expect(state.consultations[0].summary).toBeNull();
    vi.advanceTimersByTime(1500);
    expect(state.consultations[0].summary).toEqual(DEMO_SCRIPT.summary);
    vi.advanceTimersByTime(4500);
    expect(state.issues[0].stage).toBe("received");
    vi.advanceTimersByTime(1499);
    expect(state.issues[0].stage).toBe("received");
    vi.advanceTimersByTime(1);
    expect(state.issues[0].stage).toBe("classified");
    vi.advanceTimersByTime(6500);
    expect(state.alerts).toHaveLength(1);
    vi.advanceTimersByTime(5200);
    expect(state.todaySales).toBe(initial.todaySales + 1);
    expect(state.scenarioRunning).toBe(true);
    vi.advanceTimersByTime(3800);
    expect(state.scenarioRunning).toBe(false);
  });

  it("cancels pending callbacks so a reset cannot be overwritten by an old scenario", () => {
    vi.useFakeTimers();
    let state = initialSellerState();
    const cancel = scheduleDemoScenario(
      "auto",
      {
        prefix: "synthetic-cancel",
        customerId: state.customers[0].id,
        consultationId: state.consultations[0].id,
        partId: state.parts[0].id,
      },
      (event) => {
        state = sellerReducer(state, event);
      },
    );
    vi.advanceTimersByTime(1000);
    expect(state.todayConsultations).toBe(11);
    cancel();
    state = sellerReducer(state, { type: "RESET", companyCode: DEMO_COMPANIES[0].code });
    const reset = state;
    vi.advanceTimersByTime(60000);
    expect(state).toBe(reset);
    expect(state).toEqual(initialSellerState());
  });
});
