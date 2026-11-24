import { describe, expect, it } from "vitest";
import { fixtureParts } from "./fixtures/snapshot.fixture";
import {
  consultReducer,
  currentCategory,
  currentQuote,
  initialConsultState,
  isSelectionComplete,
  NEW_BUILD_STEPS,
  remainingBudget,
  selectedTotal,
} from "./state";
import type { ConsultState } from "./state";
import type {
  BudgetProposal,
  Candidate,
  CandidateResult,
  Category,
  ConsultPlan,
  Part,
  Quote,
  Survey,
  ValidationResult,
} from "./types";

// Product rows are extracted unchanged from the team's read-only snapshots in snapshot.fixture.ts.
// Validation statuses below are event inputs for reducer tests, not claimed product compatibility.
const pass: ValidationResult = { status: "PASS", checks: [], basis: "api" };
const survey: Survey = {
  mode: "new",
  budget: 1500000,
  purposes: ["other"],
  resolution: "fhd",
  frameRate: "60",
  workScale: "basic",
  problems: [],
  problemNote: "",
  owned: {},
};
const allocations: ConsultPlan["allocations"] = {
  cpu: 150000,
  motherboard: 150000,
  ram: 150000,
  gpu: 150000,
  storage: 150000,
  cooler: 150000,
  psu: 150000,
  case: 150000,
};

function part(category: Category, offset = 0): Part {
  const value = fixtureParts.filter(
    (entry) => entry.category === category && entry.current_price !== null,
  )[offset];
  if (!value) throw new Error(`Snapshot fixture has no priced ${category} row at ${offset}`);
  return value;
}

function start(
  steps: Category[] = [...NEW_BUILD_STEPS],
  mode: Survey["mode"] = "new",
): ConsultState {
  return consultReducer(initialConsultState(), {
    type: "START",
    consultationId: "reducer-test-consultation",
    survey: { ...survey, mode },
    plan: { steps, reasons: {}, allocations, criteria: [] },
  });
}

function candidate(value: Part, validation = pass): Candidate {
  return {
    part: value,
    validation,
    recommended: validation.status === "PASS",
    reason: "상태 전이 테스트",
  };
}

function provide(state: ConsultState, entry: Candidate, requestId = 1): ConsultState {
  const result: CandidateResult = {
    passed: entry.validation.status === "UNKNOWN" ? [] : [entry],
    needsReview: entry.validation.status === "UNKNOWN" ? [entry] : [],
    rejectedCount: 0,
    missingColorCount: 0,
    sortLabel: "테스트 이벤트",
    criteria: [],
    basis: "api",
  };
  return consultReducer(consultReducer(state, { type: "REQUEST", requestId }), {
    type: "CANDIDATES",
    requestId,
    result,
  });
}

function choose(state: ConsultState, value: Part): ConsultState {
  const entry = candidate(value);
  return consultReducer(provide(state, entry), { type: "SELECT", candidate: entry });
}

function complete(state: ConsultState): ConsultState {
  for (const category of state.plan?.steps ?? []) state = choose(state, part(category));
  return state;
}

function quoteFor(state: ConsultState, version = 1): Quote {
  return {
    quote_id: `test-quote-${version}`,
    consultation_id: state.consultationId,
    version,
    status: "DRAFT",
    currency: "KRW",
    total_amount: selectedTotal(state),
    created_at: "2026-11-18T00:00:00Z",
    items: Object.values(state.selected).map((value) => ({
      part_id: value.part_id,
      source_key: value.source_key,
      category: value.category,
      part_name_snapshot: value.name,
      unit_price: value.current_price!,
      quantity: 1,
      price_checked_at: value.price_checked_at,
    })),
    validation: pass,
  };
}

function createQuote(state: ConsultState, version = 1): ConsultState {
  return consultReducer(consultReducer(state, { type: "QUOTE_REQUEST", requestId: 80 }), {
    type: "QUOTE_READY",
    requestId: 80,
    quote: quoteFor(state, version),
  });
}

function confirm(state: ConsultState): ConsultState {
  const quote = currentQuote(state)!;
  return consultReducer(consultReducer(state, { type: "CONFIRM_REQUEST", requestId: 90 }), {
    type: "CONFIRMED",
    requestId: 90,
    receipt: {
      quote: { ...quote, status: "CONFIRMED" },
      storage: "session",
      message: "현재 상담에서 승인",
    },
  });
}

describe("PC consultation event reducer", () => {
  it("runs all eight new-build steps in the requested order", () => {
    let state = start();
    const visited: Category[] = [];
    while (!isSelectionComplete(state)) {
      const category = currentCategory(state)!;
      visited.push(category);
      state = choose(state, part(category));
      if (visited.length > 8) throw new Error("Consultation did not finish");
    }
    expect(visited).toEqual([
      "cpu",
      "motherboard",
      "ram",
      "gpu",
      "storage",
      "cooler",
      "psu",
      "case",
    ]);
    expect(state.screen).toBe("selection");
    expect(state.quotes).toEqual([]);
  });

  it("runs only the replacement categories supplied by the design team's plan", () => {
    let state = start(["gpu", "ram"], "replacement");
    expect(currentCategory(state)).toBe("gpu");
    state = choose(state, part("gpu"));
    expect(currentCategory(state)).toBe("ram");
    expect(isSelectionComplete(state)).toBe(false);
    state = choose(state, part("ram"));
    expect(isSelectionComplete(state)).toBe(true);
    expect(Object.keys(state.selected)).toEqual(["gpu", "ram"]);
  });

  it("recalculates remaining budget from selected snapshot prices, including an overrun", () => {
    let state = start(["gpu", "ram"], "replacement");
    state = choose(state, part("gpu"));
    expect(remainingBudget(state)).toBe(survey.budget - part("gpu").current_price!);
    state = choose(state, part("ram"));
    expect(remainingBudget(state)).toBe(
      survey.budget - part("gpu").current_price! - part("ram").current_price!,
    );
    expect(
      remainingBudget({ ...state, survey: { ...survey, budget: selectedTotal(state) - 1 } }),
    ).toBe(-1);
  });

  it("requires an explicit warning acknowledgement for an unknown candidate", () => {
    const entry = candidate(part("gpu"), { status: "UNKNOWN", checks: [], basis: "api" });
    const state = provide(start(["gpu"], "replacement"), entry);
    expect(consultReducer(state, { type: "SELECT", candidate: entry })).toBe(state);
    const acknowledged = consultReducer(state, {
      type: "SELECT",
      candidate: entry,
      allowUnknown: true,
    });
    expect(acknowledged.selected.gpu?.source_key).toBe(entry.part.source_key);
    expect(acknowledged.validations.gpu?.status).toBe("UNKNOWN");
  });

  it("rejects failed candidates and candidates not returned by the current request", () => {
    const state = provide(start(["cpu"]), candidate(part("cpu")));
    expect(consultReducer(state, { type: "SELECT", candidate: candidate(part("cpu", 1)) })).toBe(
      state,
    );
    const failed = candidate(part("cpu"), { status: "FAIL", checks: [], basis: "api" });
    const failureState = provide(start(["cpu"]), failed);
    expect(consultReducer(failureState, { type: "SELECT", candidate: failed })).toBe(failureState);
  });

  it("marks later selected parts for review when an earlier choice changes", () => {
    let state = complete(start());
    state = consultReducer(state, { type: "VISIT_STEP", index: 0 });
    expect(isSelectionComplete(state)).toBe(false);
    state = choose(state, part("cpu", 1));
    expect(state.needsReview).toEqual([
      "motherboard",
      "ram",
      "gpu",
      "storage",
      "cooler",
      "psu",
      "case",
    ]);
    expect(currentCategory(state)).toBe("motherboard");
    expect(state.selected.gpu).toBeDefined();
    for (const category of [
      "motherboard",
      "ram",
      "gpu",
      "storage",
      "cooler",
      "psu",
      "case",
    ] as Category[]) {
      state = choose(state, part(category));
    }
    expect(isSelectionComplete(state)).toBe(true);
    expect(state.needsReview).toEqual([]);
  });

  it("cannot skip an unfinished step", () => {
    const state = start();
    expect(consultReducer(state, { type: "VISIT_STEP", index: 3 })).toBe(state);
  });

  it("keeps current candidates when the active step is clicked again", () => {
    const state = provide(start(), candidate(part("cpu")));
    expect(consultReducer(state, { type: "VISIT_STEP", index: 0 })).toBe(state);
  });

  it("ignores outdated progress, candidate completion, and errors", () => {
    let state = consultReducer(start(), { type: "REQUEST", requestId: 10 });
    state = consultReducer(state, { type: "REQUEST", requestId: 11 });
    const result = provide(start(), candidate(part("cpu"))).candidates!;
    expect(
      consultReducer(state, {
        type: "PROGRESS",
        requestId: 10,
        progress: { phase: "ready", completed: 1, total: 1 },
      }),
    ).toBe(state);
    expect(consultReducer(state, { type: "CANDIDATES", requestId: 10, result })).toBe(state);
    expect(consultReducer(state, { type: "ERROR", requestId: 10, message: "old error" })).toBe(
      state,
    );
    const final = consultReducer(state, { type: "CANDIDATES", requestId: 11, result });
    expect(final.candidates).toBe(result);
    expect(final.progress?.phase).toBe("ready");
  });

  it("keeps proposed cheaper parts untouched until the user accepts", () => {
    const original = complete(start());
    const proposal: BudgetProposal = {
      alternatives: [
        { category: "cpu", before: part("cpu"), after: part("cpu", 1), validation: pass },
      ],
      beforeTotal: selectedTotal(original),
      afterTotal:
        selectedTotal(original) - part("cpu").current_price! + part("cpu", 1).current_price!,
      allocations: { ...allocations, gpu: 300000 },
      feasible: true,
      explanation: "테스트 대체안",
    };
    const opened = consultReducer(original, { type: "OPEN_BUDGET" });
    const proposed = consultReducer(opened, { type: "BUDGET_PROPOSAL", proposal });
    expect(proposed.selected).toEqual(original.selected);
    const rejected = consultReducer(proposed, { type: "REJECT_BUDGET" });
    expect(rejected.selected).toEqual(original.selected);
    expect(rejected.plan?.allocations).toEqual(original.plan?.allocations);
    const accepted = consultReducer(proposed, { type: "ACCEPT_BUDGET" });
    expect(accepted.selected.cpu).toBe(part("cpu", 1));
    expect(accepted.plan?.allocations.gpu).toBe(300000);
    expect(accepted.needsReview).toContain("motherboard");
    expect(isSelectionComplete(accepted)).toBe(false);
  });

  it("does not show a quote as complete until the matching quote event arrives", () => {
    const state = complete(start(["gpu"], "replacement"));
    const pending = consultReducer(state, { type: "QUOTE_REQUEST", requestId: 12 });
    expect(pending.quotePending).toBe(true);
    expect(pending.screen).toBe("selection");
    const quote = quoteFor(state);
    expect(consultReducer(pending, { type: "QUOTE_READY", requestId: 11, quote })).toBe(pending);
    const ready = consultReducer(pending, { type: "QUOTE_READY", requestId: 12, quote });
    expect(ready.screen).toBe("quote");
    expect(ready.quotePending).toBe(false);
  });

  it("preserves an approved quote and adds exactly one draft version after a change request", () => {
    let state = confirm(createQuote(complete(start(["cpu", "ram"], "replacement"))));
    const firstQuote = currentQuote(state)!;
    state = consultReducer(state, {
      type: "EDIT_QUOTE",
      category: "cpu",
      color: "white",
      note: "변경 요청",
    });
    expect(state.conditions).toEqual({ color: "white", note: "변경 요청" });
    state = choose(state, part("cpu", 1));
    expect(state.selected.ram).toBe(part("ram"));
    expect(state.needsReview).toEqual([]);
    state = createQuote(state, 2);
    expect(state.quotes.map((quote) => [quote.version, quote.status])).toEqual([
      [1, "CONFIRMED"],
      [2, "DRAFT"],
    ]);
    expect(state.quotes[0]).toBe(firstQuote);
    expect(state.quotes[0].items[0].source_key).toBe(part("cpu").source_key);
    expect(state.quotes[1].items[0].source_key).toBe(part("cpu", 1).source_key);
    expect(state.receipt).toBeNull();
    const lateSave = consultReducer(state, {
      type: "CONFIRMED",
      requestId: 90,
      receipt: { quote: firstQuote, storage: "session", message: "old save" },
    });
    expect(lateSave).toBe(state);
  });

  it("rejects skipped quote versions and quotes with a stale selection", () => {
    const state = complete(start(["cpu"]));
    const pending = consultReducer(state, { type: "QUOTE_REQUEST", requestId: 12 });
    const wrongVersion = consultReducer(pending, {
      type: "QUOTE_READY",
      requestId: 12,
      quote: quoteFor(state, 3),
    });
    expect(wrongVersion.quotes).toEqual([]);
    expect(wrongVersion.error).toBeTruthy();
    const wrongItems = { ...quoteFor(state), items: [] };
    expect(
      consultReducer(pending, { type: "QUOTE_READY", requestId: 12, quote: wrongItems }).quotes,
    ).toEqual([]);
  });

  it("cancels a change request without losing the previous configuration or version", () => {
    const original = createQuote(complete(start(["cpu", "ram"])));
    let state = consultReducer(original, { type: "EDIT_QUOTE", category: "cpu" });
    state = choose(state, part("cpu", 1));
    state = consultReducer(state, { type: "CANCEL_EDIT" });
    expect(state.screen).toBe("quote");
    expect(state.selected).toEqual(original.selected);
    expect(state.quotes).toEqual(original.quotes);
  });

  it("can quote a single-part edit after accepting budget alternatives", () => {
    const original = createQuote(complete(start()));
    let state = consultReducer(original, { type: "EDIT_QUOTE", category: "gpu" });
    state = consultReducer(state, { type: "OPEN_BUDGET" });
    state = consultReducer(state, {
      type: "BUDGET_PROPOSAL",
      proposal: {
        alternatives: [
          { category: "cpu", before: part("cpu"), after: part("cpu", 1), validation: pass },
        ],
        beforeTotal: selectedTotal(original),
        afterTotal: selectedTotal(original),
        allocations: { ...allocations, gpu: 300000 },
        feasible: true,
        explanation: "시연 대체안 이벤트",
      },
    });
    state = consultReducer(state, { type: "ACCEPT_BUDGET" });
    expect(state.needsReview).toEqual([]);
    expect(currentCategory(state)).toBe("gpu");
    state = choose(state, part("gpu"));
    expect(isSelectionComplete(state)).toBe(true);
    state = createQuote(state, 2);
    expect(state.screen).toBe("quote");
    expect(state.quotes).toHaveLength(2);
  });

  it("restores the allocation and saved receipt when a budget-assisted edit is cancelled", () => {
    const original = confirm(createQuote(complete(start())));
    let state = consultReducer(original, { type: "EDIT_QUOTE", category: "gpu" });
    state = consultReducer(state, { type: "OPEN_BUDGET" });
    state = consultReducer(state, {
      type: "BUDGET_PROPOSAL",
      proposal: {
        alternatives: [],
        beforeTotal: selectedTotal(original),
        afterTotal: selectedTotal(original),
        allocations: { ...allocations, gpu: 300000 },
        feasible: true,
        explanation: "시연 한도 변경",
      },
    });
    state = consultReducer(state, { type: "ACCEPT_BUDGET" });
    expect(state.receipt).toBeNull();
    expect(state.plan?.allocations.gpu).toBe(300000);
    state = consultReducer(state, { type: "CANCEL_EDIT" });
    expect(state.selected).toEqual(original.selected);
    expect(state.plan?.allocations).toEqual(original.plan?.allocations);
    expect(state.receipt).toBe(original.receipt);
    expect(consultReducer(state, { type: "SHOW_SAVED" }).screen).toBe("saved");
  });

  it("opens replacement payment only after a save succeeds, never for new builds", () => {
    let replacement = createQuote(complete(start(["gpu"], "replacement")));
    expect(consultReducer(replacement, { type: "PAYMENT" })).toBe(replacement);
    const saving = consultReducer(replacement, { type: "CONFIRM_REQUEST", requestId: 1 });
    expect(consultReducer(saving, { type: "PAYMENT" })).toBe(saving);
    replacement = confirm(replacement);
    expect(consultReducer(replacement, { type: "PAYMENT" }).screen).toBe("payment");
    const newBuild = confirm(createQuote(complete(start())));
    expect(consultReducer(newBuild, { type: "PAYMENT" })).toBe(newBuild);
  });

  it("clears save/quote in-flight state on matching errors so the user can retry", () => {
    const state = createQuote(complete(start(["gpu"], "replacement")));
    const pending = consultReducer(state, { type: "CONFIRM_REQUEST", requestId: 1 });
    const failed = consultReducer(pending, {
      type: "ERROR",
      requestId: 1,
      message: "저장에 실패했습니다.",
    });
    expect(failed.savePending).toBe(false);
    expect(failed.screen).toBe("quote");
    expect(failed.error).toBe("저장에 실패했습니다.");
    expect(consultReducer(failed, { type: "CONFIRM_REQUEST", requestId: 2 }).savePending).toBe(
      true,
    );
  });

  it("reopens only the current saved and unchanged quote", () => {
    const draft = createQuote(complete(start(["gpu"], "replacement")));
    expect(consultReducer(draft, { type: "SHOW_SAVED" })).toBe(draft);
    const saved = confirm(draft);
    const history = consultReducer(saved, { type: "VIEW_QUOTE" });
    expect(history.screen).toBe("quote");
    expect(consultReducer(history, { type: "SHOW_SAVED" }).screen).toBe("saved");
    const editing = consultReducer(history, { type: "EDIT_QUOTE", category: "gpu" });
    expect(consultReducer(editing, { type: "SHOW_SAVED" })).toBe(editing);
  });
});
