import { afterEach, describe, expect, it, vi } from "vitest";
import { printOut } from "../../office/officeCues";
import { B2B_METRICS, FEEDBACK_DEMO } from "./mockData";
import {
  initialSellerRuntime,
  issueTimeline,
  selectSellerOperations,
  sellerRuntimeReducer,
} from "./operations";
import type { SellerEvent } from "./sellerState";
import type { PreviewHandoffInput, SellerRole } from "./types";
import { scheduleDemoScenario } from "./useSellerDemo";
import { normalizeSellerMenu, SELLER_MENUS } from "./SellerNavigation";

// All customers and consultations below are the explicitly synthetic mockData fixture records.
const receivedAt = "2026-11-20T01:00:00Z";
function runtime(role: SellerRole = "admin") {
  let value = initialSellerRuntime("BW-1001");
  return {
    get: () => value,
    send: (event: SellerEvent) => {
      value = sellerRuntimeReducer(value, event, role, receivedAt);
      return value;
    },
  };
}
function preview(): PreviewHandoffInput {
  return {
    id: "synthetic-preview",
    reasons: ["시연 할인 요청은 담당자 확인이 필요합니다."],
    messages: [
      {
        speaker: "고객",
        text: "시연 할인 조건을 확인해 주세요.",
        occurredAt: "2026-11-20T01:00:01Z",
      },
    ],
    teamNotes: [
      { team: "design", message: "정책 확인을 요청했습니다.", occurredAt: "2026-11-20T01:00:02Z" },
    ],
  };
}
afterEach(() => vi.useRealTimers());

describe("기업 운영 이벤트와 사람 인계", () => {
  it("routes feedback improvements to the shared product-policy area with administrator protection", () => {
    const admin = runtime("admin");
    const staff = runtime("agent");
    expect(FEEDBACK_DEMO.actions.map((action) => action.action)).toEqual(
      expect.arrayContaining(["catalog", "documents"]),
    );
    for (const action of FEEDBACK_DEMO.actions) {
      const menu = normalizeSellerMenu(action.action);
      expect(menu).toBe("catalog");
      expect(SELLER_MENUS.find((entry) => entry.id === menu)?.admin).toBe(true);
      expect(admin.send({ type: "NAVIGATE", menu }).state.menu).toBe("catalog");
      expect(staff.send({ type: "NAVIGATE", menu }).state.menu).toBe("home");
    }
  });

  it("initializes visible synthetic receipts without inventing a completed consultation or quote", () => {
    const value = initialSellerRuntime("BW-1001");
    expect(value.performance.consultations).toBe(value.state.todayConsultations);
    expect(value.performance.completed).toBe(value.state.completedConsultations);
    expect(value.performance.completed).toBe(
      value.performance.automaticallyResolved + value.performance.handedOff,
    );
    expect(value.events.every((event) => event.message.includes("가상 초기 기록"))).toBe(true);
    expect(selectSellerOperations(value.events)).not.toHaveLength(0);
    expect(Object.values(value.office.teams).every((team) => team.activeTasks === 0)).toBe(true);
    expect(printOut(value.office)).toBeNull();
    expect(value.state.customers).toHaveLength(20);
    expect(value.state.consultations).toHaveLength(40);
  });

  it("preserves administrator restrictions while allowing shared team, feedback and preview views", () => {
    const demo = runtime("agent");
    for (const menu of ["catalog", "employees"] as const) {
      expect(demo.send({ type: "NAVIGATE", menu }).state.menu).toBe("home");
    }
    for (const menu of ["teams", "feedback", "preview"] as const) {
      expect(demo.send({ type: "NAVIGATE", menu }).state.menu).toBe(menu);
    }
    const before = demo.get();
    const denied = demo.send({ type: "POLICY_SAVED", version: 1 });
    expect(denied.state.policyVersion).toBe(0);
    expect(denied.events).toBe(before.events);
    expect(denied.office).toBe(before.office);
  });

  it("records a saved policy once with its version and never prints a PC quote", () => {
    const demo = runtime();
    const before = demo.get();
    const saved = demo.send({ type: "POLICY_SAVED", version: 2 });
    expect(saved.state.policyVersion).toBe(2);
    expect(saved.events.at(-1)).toMatchObject({
      team: "design",
      type: "task.completed",
      status: "completed",
    });
    expect(saved.events.at(-1)?.message).toContain("정책 v2");
    expect(saved.state.shippingFee).toBe(before.state.shippingFee);
    expect(saved.state.discount).toBe(before.state.discount);
    expect(saved.performance).toBe(before.performance);
    expect(selectSellerOperations(saved.events)[0].menu).toBe("catalog");
    expect(printOut(saved.office)).toBeNull();
    expect(demo.send({ type: "POLICY_SAVED", version: 2 }).events).toBe(saved.events);
    expect(demo.send({ type: "POLICY_SAVED", version: 1 }).events).toBe(saved.events);
  });

  it("does not finish document work before an accepted completion receipt", () => {
    const demo = runtime();
    const initial = demo.get();
    const complete: SellerEvent = {
      type: "UPLOAD_COMPLETED",
      id: "synthetic-document",
      title: initial.state.documents[0].title,
      kind: "FAQ",
    };
    expect(demo.send(complete).events).toBe(initial.events);
    demo.send({ type: "UPLOAD_STARTED" });
    const progress = demo.send({ type: "UPLOAD_PROGRESS", progress: 75 });
    expect(progress.state.documents).toBe(initial.state.documents);
    expect(progress.office.teams.design.activeTasks).toBe(1);
    expect(progress.office.teams.design.status).toBe("running");
    const done = demo.send(complete);
    expect(done.state.documents).toHaveLength(initial.state.documents.length + 1);
    expect(done.office.teams.design.activeTasks).toBe(0);
    expect(done.events.at(-1)?.type).toBe("task.completed");
    expect(demo.send(complete).events).toBe(done.events);
  });

  it("does not consume a consultation summary task when an older-version upload completes", () => {
    const demo = runtime();
    demo.send({ type: "UPLOAD_STARTED" });
    demo.send({
      type: "CONSULT_STARTED",
      id: "synthetic-during-upload",
      customerId: demo.get().state.customers[0].id,
    });
    demo.send({ type: "HANDOFF_STARTED", consultationId: "synthetic-during-upload" });
    expect(demo.get().office.teams.design.activeTasks).toBe(1);
    const uploaded = demo.send({
      type: "UPLOAD_COMPLETED",
      id: "synthetic-late-upload",
      title: demo.get().state.documents[0].title,
      kind: "FAQ",
    });
    expect(uploaded.office.teams.design.activeTasks).toBe(1);
    expect(uploaded.office.teams.design.status).toBe("running");
    expect(
      demo.send({ type: "SUMMARY_READY", consultationId: "synthetic-during-upload" }).office.teams
        .design.activeTasks,
    ).toBe(0);
  });

  it("cancels classification when a person takes the issue before the actual timer finishes", () => {
    vi.useFakeTimers();
    const demo = runtime();
    const initial = demo.get().state;
    const cancel = scheduleDemoScenario(
      "claim",
      {
        prefix: "synthetic-classification",
        customerId: initial.customers[0].id,
        consultationId: "",
        partId: initial.parts[0].id,
      },
      demo.send,
    );
    vi.advanceTimersByTime(0);
    expect(demo.get().office.teams.validation.activeTasks).toBe(1);
    demo.send({
      type: "ASSIGN_ISSUE",
      id: "synthetic-classification-issue",
      assignee: initial.employees[1].name,
    });
    expect(demo.get().office.teams.validation.activeTasks).toBe(0);
    expect(demo.get().office.teams.validation.status).toBe("cancelled");
    const manual = demo.get().events;
    vi.advanceTimersByTime(1500);
    expect(demo.get().state.issues[0].stage).toBe("working");
    expect(demo.get().events).toBe(manual);
    demo.send({ type: "COMPLETE_ISSUE", id: "synthetic-classification-issue" });
    expect(Object.values(demo.get().office.teams).every((team) => team.activeTasks === 0)).toBe(
      true,
    );
    expect(printOut(demo.get().office)).toBeNull();
    cancel();
  });

  it("keeps a journal of concurrent manual work while preserving an unfinished handoff desk", () => {
    const demo = runtime();
    demo.send({ type: "SCENARIO_STARTED" });
    demo.send({
      type: "CONSULT_STARTED",
      id: "synthetic-handoff",
      customerId: demo.get().state.customers[0].id,
    });
    demo.send({ type: "HANDOFF_STARTED", consultationId: "synthetic-handoff" });
    const working = demo.get();
    const issue = working.state.issues.find((entry) => entry.stage !== "done")!;
    demo.send({ type: "ASSIGN_ISSUE", id: issue.id, assignee: working.state.employees[1].name });
    demo.send({ type: "COMPLETE_ISSUE", id: issue.id });
    expect(demo.get().office).toBe(working.office);
    expect(demo.get().events.length).toBeGreaterThan(working.events.length);
    demo.send({ type: "SUMMARY_READY", consultationId: "synthetic-handoff" });
    expect(demo.get().office.teams.design.status).toBe("completed");
    const seq = demo.get().events.map((event) => event.seq);
    expect(new Set(seq).size).toBe(seq.length);
    expect(seq.every((value, index) => index === 0 || value > seq[index - 1])).toBe(true);
  });

  it("copies preview evidence into one handoff and waits for a person without automatic completion", () => {
    const demo = runtime("agent");
    const input = preview();
    const initial = demo.get();
    const next = demo.send({ type: "PREVIEW_HANDOFF", input });
    const issue = next.state.issues[0];
    expect(issue.stage).toBe("received");
    expect(issue.assignee).toBe("미배정");
    expect(issue.lines).toEqual(input.messages);
    expect(issue.teamNotes).toEqual(input.teamNotes);
    expect(next.office.runStatus).toBe("needs_input");
    expect(next.performance.consultations).toBe(initial.performance.consultations + 1);
    expect(next.performance.handedOff).toBe(initial.performance.handedOff + 1);
    expect(next.performance.automaticallyResolved).toBe(initial.performance.automaticallyResolved);
    input.messages[0].text = "입력 원본의 시연 수정";
    input.reasons.push("추가 시연 수정");
    expect(issue.lines?.[0].text).not.toBe(input.messages[0].text);
    expect(issue.reasons).toHaveLength(1);
    expect(demo.send({ type: "PREVIEW_HANDOFF", input }).events).toBe(next.events);
    expect(printOut(next.office)).toBeNull();
  });

  it("sorts customer and team evidence by real timestamps while leaving absent times unknown", () => {
    const demo = runtime();
    const input = preview();
    input.messages.push({
      speaker: "AI 상담 직원",
      text: "앞선 시연 안내",
      occurredAt: "2026-11-20T01:00:00Z",
    });
    input.messages.push({ speaker: "고객", text: "시각이 없는 시연 메모" });
    const issue = demo.send({ type: "PREVIEW_HANDOFF", input }).state.issues[0];
    const timeline = issueTimeline(issue);
    expect(timeline.map((entry) => entry.text)).toEqual([
      "앞선 시연 안내",
      input.messages[0].text,
      input.teamNotes[0].message,
      "시각이 없는 시연 메모",
    ]);
    expect(Number.isNaN(timeline.at(-1)!.timestamp)).toBe(true);
  });

  it("updates consultation performance only at accepted consultation receipts", () => {
    const demo = runtime();
    const initial = demo.get().performance;
    demo.send({
      type: "CONSULT_STARTED",
      id: "synthetic-performance",
      customerId: demo.get().state.customers[0].id,
    });
    demo.send({ type: "HANDOFF_STARTED", consultationId: "synthetic-performance" });
    expect(demo.get().performance.completed).toBe(initial.completed);
    demo.send({ type: "POLICY_SAVED", version: 1 });
    expect(demo.get().performance.automaticallyResolved).toBe(initial.automaticallyResolved);
    const done = demo.send({ type: "SUMMARY_READY", consultationId: "synthetic-performance" });
    expect(done.performance.consultations).toBe(initial.consultations + 1);
    expect(done.performance.completed).toBe(initial.completed + 1);
    expect(done.performance.handedOff).toBe(initial.handedOff + 1);
    expect(
      demo.send({ type: "SUMMARY_READY", consultationId: "synthetic-performance" }).performance,
    ).toBe(done.performance);
  });

  it("records sale and masked alert receipts without declaring an entire consultation complete", () => {
    const demo = runtime();
    const initial = demo.get().state;
    demo.send({
      type: "ABUSE_DETECTED",
      id: "synthetic-alert",
      customerId: initial.customers[0].id,
    });
    expect(demo.get().events.at(-1)?.message).toContain("***");
    const sold = demo.send({
      type: "SALE_COMPLETED",
      id: "synthetic-sale",
      customerId: initial.customers[0].id,
      partId: initial.parts[0].id,
    });
    expect(sold.events.at(-1)?.type).toBe("order.created");
    expect(sold.state.todaySales).toBe(initial.todaySales + 1);
    expect(selectSellerOperations(sold.events)[0].menu).toBe("sales");
    expect(sold.events.some((event) => event.type === "run.completed")).toBe(false);
    expect(printOut(sold.office)).toBeNull();
  });

  it("resets journals and cohort with the company while ignoring old completion callbacks", () => {
    const demo = runtime();
    demo.send({
      type: "CONSULT_STARTED",
      id: "synthetic-old",
      customerId: demo.get().state.customers[0].id,
    });
    demo.send({ type: "HANDOFF_STARTED", consultationId: "synthetic-old" });
    const reset = demo.send({ type: "RESET", companyCode: "BW-2002" });
    expect(reset.performance).toEqual(B2B_METRICS);
    expect(reset.events.every((event) => event.session_id.includes("BW-2002"))).toBe(true);
    expect(demo.send({ type: "SUMMARY_READY", consultationId: "synthetic-old" }).events).toBe(
      reset.events,
    );
    expect(
      FEEDBACK_DEMO.actions.every((action) => action.message.startsWith("가상 고객 피드백")),
    ).toBe(true);
  });
});
