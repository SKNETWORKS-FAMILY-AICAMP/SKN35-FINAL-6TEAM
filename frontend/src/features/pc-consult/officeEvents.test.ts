import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "../../api/client";
import { handoff, latestQuote, printOut, validators } from "../office/officeCues";
import { initialOfficeState, officeReducer } from "../office/officeState";
import { fixturePart } from "./fixtures/demoSnapshot.fixture";
import { createOfficeEventAdapter } from "./officeEvents";
import {
  consultReducer,
  currentQuote,
  initialConsultState,
  selectedTotal,
  type ConsultEvent,
  type ConsultState,
} from "./state";
import type { Candidate, CandidateResult, Quote, Survey, ValidationResult } from "./types";
import { won } from "./types";
import { createOfficeBridge } from "./useOfficeBridge";

// Product rows are copied from the team's read-only snapshot fixture. PASS is only a
// reducer-control outcome here, not a claim about those products' actual compatibility.
const validation: ValidationResult = { status: "PASS", checks: [], basis: "demo" };
const candidate: Candidate = {
  part: fixturePart("cpu"),
  validation,
  recommended: true,
  reason: "상태 전이 견본",
};
const result: CandidateResult = {
  passed: [candidate],
  needsReview: [],
  rejectedCount: 0,
  missingColorCount: 0,
  sortLabel: "가격 낮은 순 (판매량 데이터 준비 중)",
  criteria: [],
  basis: "demo",
};
const survey: Survey = {
  mode: "replacement",
  budget: 1000000,
  purposes: ["other"],
  resolution: "fhd",
  frameRate: "60",
  workScale: "basic",
  problems: ["작업이 느림"],
  problemNote: "",
  owned: {},
};
const start: ConsultEvent = {
  type: "START",
  survey,
  consultationId: "office-test",
  plan: {
    steps: ["cpu"],
    reasons: {},
    allocations: {
      cpu: 1000000,
      motherboard: 0,
      ram: 0,
      gpu: 0,
      storage: 0,
      cooler: 0,
      psu: 0,
      case: 0,
    },
    criteria: [],
  },
};

function quoteFor(state: ConsultState): Quote {
  return {
    quote_id: `${state.consultationId}/1`,
    consultation_id: state.consultationId,
    version: state.quotes.length + 1,
    status: "DRAFT",
    currency: "KRW",
    total_amount: selectedTotal(state),
    created_at: "2026-11-18T00:00:00Z",
    items: Object.values(state.selected).map((part) => ({
      part_id: part.part_id,
      source_key: part.source_key,
      category: part.category,
      part_name_snapshot: part.name,
      unit_price: part.current_price!,
      quantity: 1,
      price_checked_at: part.price_checked_at,
    })),
    validation,
  };
}

function harness() {
  const adapter = createOfficeEventAdapter("test-office");
  let consult = initialConsultState();
  let office = initialOfficeState();
  const records: AgentEvent[] = [];
  const transfers: Array<{ from: string; to: string }> = [];
  function send(event: ConsultEvent) {
    const next = consultReducer(consult, event);
    const emitted = adapter.transition(event, consult, next);
    for (const record of emitted) {
      office = officeReducer(office, record);
      records.push(record);
      const transfer = handoff(office);
      if (transfer) transfers.push(transfer);
    }
    consult = next;
    return emitted;
  }
  function select() {
    send(start);
    send({ type: "REQUEST", requestId: 1 });
    send({ type: "CANDIDATES", requestId: 1, result });
    send({ type: "SELECT", candidate });
  }
  function quote() {
    select();
    send({ type: "QUOTE_REQUEST", requestId: 2 });
    send({ type: "QUOTE_READY", requestId: 2, quote: quoteFor(consult) });
  }
  function confirm() {
    send({ type: "CONFIRM_REQUEST", requestId: 3 });
    send({
      type: "CONFIRMED",
      requestId: 3,
      receipt: {
        quote: { ...currentQuote(consult)!, status: "CONFIRMED" },
        storage: "memory",
        message: "시연 저장 (DB에 기록 안 됨)",
      },
    });
  }
  return {
    send,
    select,
    quote,
    confirm,
    records,
    transfers,
    get consult() {
      return consult;
    },
    get office() {
      return office;
    },
  };
}

afterEach(() => vi.useRealTimers());

describe("PC consultation office event adapter", () => {
  it("hands actual work between teams and keeps sequential validation to one active task", () => {
    const app = harness();
    app.send(start);
    app.send({ type: "REQUEST", requestId: 1 });
    expect(app.transfers).toContainEqual(
      expect.objectContaining({ from: "consultation", to: "design" }),
    );
    for (const completed of [0, 64, 128]) {
      app.send({
        type: "PROGRESS",
        requestId: 1,
        progress: { phase: "validation", completed, total: 128 },
      });
      expect(validators(app.office)).toEqual({ count: 1, overflow: 0 });
    }
    app.send({
      type: "PROGRESS",
      requestId: 1,
      progress: { phase: "ready", completed: 128, total: 128 },
    });
    expect(app.office.teams.validation.status).toBe("running");
    app.send({ type: "CANDIDATES", requestId: 1, result });
    expect(app.transfers).toContainEqual(
      expect.objectContaining({ from: "design", to: "validation" }),
    );
    expect(app.transfers).toContainEqual(
      expect.objectContaining({ from: "validation", to: "design" }),
    );
    expect(app.office.runStatus).toBe("needs_input");
    expect(Object.values(app.office.teams).every((team) => team.activeTasks === 0)).toBe(true);
    expect(app.records.map((event) => event.seq)).toEqual(app.records.map((_, index) => index + 1));
    expect(app.records.every((event) => event.requirement_version === 1)).toBe(true);
    expect(app.records.every((event) => event.metrics?.duration_ms === undefined)).toBe(true);
  });

  it("keeps unavailable candidates visible as a user decision, without claiming a pass", () => {
    const app = harness();
    app.send(start);
    app.send({ type: "REQUEST", requestId: 1 });
    app.send({
      type: "CANDIDATES",
      requestId: 1,
      result: {
        ...result,
        passed: [],
        needsReview: [
          { ...candidate, recommended: false, validation: { ...validation, status: "UNKNOWN" } },
        ],
      },
    });
    expect(app.office.teams.validation.message).toContain("통과·조건부 0개, 확인 필요 1개");
    expect(app.office.runMessage).toContain("통과한 후보가 없습니다");
    expect(printOut(app.office)).toBeNull();
  });

  it("ignores rejected or stale consultation transitions", () => {
    const app = harness();
    app.send(start);
    app.send({ type: "REQUEST", requestId: 5 });
    const seq = app.office.lastSeq;
    expect(app.send({ type: "CANDIDATES", requestId: 4, result })).toEqual([]);
    expect(
      app.send({
        type: "CONFIRMED",
        requestId: 4,
        receipt: { quote: quoteFor(app.consult), storage: "memory", message: "old" },
      }),
    ).toEqual([]);
    expect(app.office.lastSeq).toBe(seq);
  });

  it("shows the real quote amount but prints only after successful approval and save", () => {
    const app = harness();
    app.quote();
    expect(latestQuote(app.office)?.message).toContain(
      won(currentQuote(app.consult)!.total_amount),
    );
    expect(app.office.runStatus).toBe("needs_input");
    expect(printOut(app.office)).toBeNull();
    expect(app.transfers).toContainEqual(
      expect.objectContaining({ from: "validation", to: "quotation" }),
    );
    app.send({ type: "CONFIRM_REQUEST", requestId: 3 });
    expect(printOut(app.office)).toBeNull();
    const save = {
      type: "CONFIRMED",
      requestId: 3,
      receipt: {
        quote: { ...currentQuote(app.consult)!, status: "CONFIRMED" },
        storage: "memory",
        message: "시연 저장 (DB에 기록 안 됨)",
      },
    } as const;
    app.send(save);
    expect(printOut(app.office)).toBe(app.office.lastSeq);
    expect(app.office.runMessage).toContain("DB에 기록 안 됨");
    expect(app.send(save)).toEqual([]);
    expect(app.records.filter((event) => event.type === "run.completed")).toHaveLength(1);
  });

  it("clears previous approval cues for revised requirements without resetting sequence", () => {
    const app = harness();
    app.quote();
    app.confirm();
    const previousSeq = app.office.lastSeq;
    app.send({ type: "EDIT_QUOTE", category: "cpu" });
    expect(app.office.version).toBe(2);
    expect(app.office.lastSeq).toBeGreaterThan(previousSeq);
    expect(printOut(app.office)).toBeNull();
    expect(latestQuote(app.office)).toBeNull();
    app.send({ type: "CANCEL_EDIT" });
    expect(app.office.version).toBe(3);
    expect(latestQuote(app.office)?.message).toContain("이미 승인·저장한 기록");
    expect(printOut(app.office)).toBeNull();
  });

  it("closes the failed task and retries in the same requirement version", () => {
    const app = harness();
    app.send(start);
    app.send({ type: "REQUEST", requestId: 1 });
    app.send({
      type: "PROGRESS",
      requestId: 1,
      progress: { phase: "validation", completed: 0, total: 10 },
    });
    app.send({ type: "ERROR", requestId: 1, message: "스냅샷 오류" });
    expect(validators(app.office).count).toBe(0);
    expect(app.office.runStatus).toBe("failed");
    expect(app.office.runError?.retryable).toBe(true);
    app.send({ type: "REQUEST", requestId: 2 });
    expect(app.office.version).toBe(1);
    expect(app.office.teams.design.activeTasks).toBe(1);
    expect(printOut(app.office)).toBeNull();
  });

  it("does not complete a quote rejected by the consultation reducer", () => {
    const app = harness();
    app.select();
    app.send({ type: "QUOTE_REQUEST", requestId: 2 });
    app.send({
      type: "QUOTE_READY",
      requestId: 2,
      quote: { ...quoteFor(app.consult), version: 9 },
    });
    expect(app.office.runStatus).toBe("failed");
    expect(app.office.teams.validation.activeTasks).toBe(0);
    expect(latestQuote(app.office)).toBeNull();
    expect(printOut(app.office)).toBeNull();
  });
});

describe("cancellable office playback queue", () => {
  function setup() {
    vi.useFakeTimers();
    const bridge = createOfficeBridge("queue-test", 100);
    let state = initialConsultState();
    function send(event: ConsultEvent) {
      const next = consultReducer(state, event);
      const promise = bridge.receive(event, state, next);
      state = next;
      return promise;
    }
    return { bridge, send };
  }

  it("keeps the requested interval across singleton batches and immediately resumes after idle", async () => {
    const { bridge, send } = setup();
    await send(start);
    expect(bridge.getSnapshot().lastSeq).toBe(1);
    const request = send({ type: "REQUEST", requestId: 1 });
    expect(bridge.getSnapshot().lastSeq).toBe(1);
    await vi.advanceTimersByTimeAsync(99);
    expect(bridge.getSnapshot().lastSeq).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(bridge.getSnapshot().lastSeq).toBe(2);
    expect(bridge.getSnapshot().runEvent?.type).toBe("run.started");
    expect(bridge.getSnapshot().teams.design.activeTasks).toBe(0);
    await vi.advanceTimersByTimeAsync(100);
    await request;
    expect(bridge.getSnapshot().lastSeq).toBe(3);
    expect(bridge.getSnapshot().teams.design.activeTasks).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    const progress = send({
      type: "PROGRESS",
      requestId: 1,
      progress: { phase: "design", completed: 0, total: 0 },
    });
    expect(bridge.getSnapshot().lastSeq).toBe(4);
    await progress;
  });

  it("resolves completion only after its events have actually been displayed", async () => {
    const { bridge, send } = setup();
    await send(start);
    const request = send({ type: "REQUEST", requestId: 1 });
    await vi.runAllTimersAsync();
    await request;
    const settled = vi.fn();
    void send({ type: "CANDIDATES", requestId: 1, result }).then(settled);
    expect(settled).not.toHaveBeenCalled();
    expect(bridge.getSnapshot().runStatus).toBe("running");
    await vi.runAllTimersAsync();
    expect(settled).toHaveBeenCalledOnce();
    expect(bridge.getSnapshot().runStatus).toBe("needs_input");
  });

  it("cancels queued completion, settles every waiter, and clears active tasks", async () => {
    const { bridge, send } = setup();
    await send(start);
    const request = send({ type: "REQUEST", requestId: 1 });
    const completion = send({ type: "CANDIDATES", requestId: 1, result });
    bridge.cancel();
    await Promise.all([request, completion]);
    const cancelled = bridge.getSnapshot();
    expect(cancelled.runStatus).toBe("cancelled");
    expect(Object.values(cancelled.teams).every((team) => team.activeTasks === 0)).toBe(true);
    await vi.runAllTimersAsync();
    expect(bridge.getSnapshot()).toBe(cancelled);
    expect(printOut(cancelled)).toBeNull();
    const retry = send({ type: "REQUEST", requestId: 2 });
    await vi.runAllTimersAsync();
    await retry;
    expect(bridge.getSnapshot().lastSeq).toBe(cancelled.lastSeq + 2);
    expect(bridge.getSnapshot().teams.design.activeTasks).toBe(1);
  });

  it("coalesces queued progress without losing terminal events or promise resolution", async () => {
    const { bridge, send } = setup();
    await send(start);
    const promises = [send({ type: "REQUEST", requestId: 1 })];
    for (let completed = 0; completed <= 100; completed++)
      promises.push(
        send({
          type: "PROGRESS",
          requestId: 1,
          progress: { phase: "validation", completed, total: 100 },
        }),
      );
    promises.push(send({ type: "CANDIDATES", requestId: 1, result }));
    await vi.runAllTimersAsync();
    await Promise.all(promises);
    const log = bridge.getSnapshot().teams.validation.log;
    expect(log.filter((event) => event.type === "task.started")).toHaveLength(1);
    expect(log.filter((event) => event.type === "task.progress")).toHaveLength(1);
    expect(log.find((event) => event.type === "task.progress")?.metrics).toEqual({
      completed: 100,
      total: 100,
    });
    expect(bridge.getSnapshot().runStatus).toBe("needs_input");
    expect(bridge.getSnapshot().lastSeq).toBeLessThan(20);
  });

  it("never prints a saved result whose display queue was cancelled", async () => {
    vi.useFakeTimers();
    const bridge = createOfficeBridge("cancel-save", 100);
    const app = harness();
    app.quote();
    const draft = app.consult;
    const savingEvent: ConsultEvent = { type: "CONFIRM_REQUEST", requestId: 3 };
    const saving = consultReducer(draft, savingEvent);
    const pending = bridge.receive(savingEvent, draft, saving);
    await vi.runAllTimersAsync();
    await pending;
    const savedEvent: ConsultEvent = {
      type: "CONFIRMED",
      requestId: 3,
      receipt: {
        quote: { ...currentQuote(draft)!, status: "CONFIRMED" },
        storage: "memory",
        message: "시연 저장 (DB에 기록 안 됨)",
      },
    };
    const saved = bridge.receive(savedEvent, saving, consultReducer(saving, savedEvent));
    await vi.advanceTimersByTimeAsync(100);
    // quotation.completed can be visible; the queued run.completed must still be cancellable.
    expect(bridge.getSnapshot().teams.quotation.status).toBe("completed");
    expect(printOut(bridge.getSnapshot())).toBeNull();
    bridge.cancel();
    await saved;
    await vi.runAllTimersAsync();
    expect(bridge.getSnapshot().runStatus).toBe("cancelled");
    expect(printOut(bridge.getSnapshot())).toBeNull();
  });

  it("automatically discards an awaiting candidate result when conditions change", async () => {
    vi.useFakeTimers();
    const bridge = createOfficeBridge("changed-request", 100);
    const initial = initialConsultState();
    const started = consultReducer(initial, start);
    await bridge.receive(start, initial, started);
    const request: ConsultEvent = { type: "REQUEST", requestId: 1 };
    const waiting = consultReducer(started, request);
    const pending = bridge.receive(request, started, waiting);
    await vi.runAllTimersAsync();
    await pending;
    const candidates: ConsultEvent = { type: "CANDIDATES", requestId: 1, result };
    const oldResult = bridge.receive(candidates, waiting, consultReducer(waiting, candidates));
    const change: ConsultEvent = { type: "SET_CONDITIONS", color: "white", note: "" };
    const changed = consultReducer(waiting, change);
    const changedDisplay = bridge.receive(change, waiting, changed);
    await oldResult;
    const retry: ConsultEvent = { type: "REQUEST", requestId: 2 };
    const retried = bridge.receive(retry, changed, consultReducer(changed, retry));
    await vi.runAllTimersAsync();
    await Promise.all([changedDisplay, retried]);
    expect(bridge.getSnapshot().version).toBe(2);
    expect(bridge.getSnapshot().runStatus).toBe("running");
    expect(bridge.getSnapshot().teams.design.activeTasks).toBe(1);
    expect(bridge.getSnapshot().teams.validation.log).toEqual([]);
    expect(printOut(bridge.getSnapshot())).toBeNull();
  });

  it("replacing an in-flight request does not replay the former completion", async () => {
    vi.useFakeTimers();
    const bridge = createOfficeBridge("replace-request", 100);
    const initial = initialConsultState();
    const started = consultReducer(initial, start);
    await bridge.receive(start, initial, started);
    const request: ConsultEvent = { type: "REQUEST", requestId: 1 };
    const waiting = consultReducer(started, request);
    const pending = bridge.receive(request, started, waiting);
    await vi.runAllTimersAsync();
    await pending;
    const candidates: ConsultEvent = { type: "CANDIDATES", requestId: 1, result };
    const oldResult = bridge.receive(candidates, waiting, consultReducer(waiting, candidates));
    const retry: ConsultEvent = { type: "REQUEST", requestId: 2 };
    const replacement = bridge.receive(retry, waiting, consultReducer(waiting, retry));
    await oldResult;
    await vi.runAllTimersAsync();
    await replacement;
    expect(bridge.getSnapshot().version).toBe(1);
    expect(bridge.getSnapshot().runStatus).toBe("running");
    expect(bridge.getSnapshot().teams.design.activeTasks).toBe(1);
    expect(
      bridge.getSnapshot().teams.validation.log.some((event) => event.type === "task.completed"),
    ).toBe(false);
  });

  it("resets in-flight work and supports StrictMode cleanup followed by setup", async () => {
    const { bridge, send } = setup();
    await send(start);
    const pending = send({ type: "REQUEST", requestId: 1 });
    bridge.dispose();
    await pending;
    const disabled = bridge.getSnapshot();
    await send({
      type: "PROGRESS",
      requestId: 1,
      progress: { phase: "validation", completed: 0, total: 1 },
    });
    expect(bridge.getSnapshot()).toBe(disabled);
    bridge.activate();
    bridge.reset();
    expect(bridge.getSnapshot()).toEqual(initialOfficeState());
    await send(start);
    const fresh = send({ type: "REQUEST", requestId: 2 });
    await vi.runAllTimersAsync();
    await fresh;
    expect(bridge.getSnapshot().version).toBe(1);
    expect(bridge.getSnapshot().teams.design.activeTasks).toBe(1);
    expect(bridge.getSnapshot().lastSeq).toBe(3);
  });
});
