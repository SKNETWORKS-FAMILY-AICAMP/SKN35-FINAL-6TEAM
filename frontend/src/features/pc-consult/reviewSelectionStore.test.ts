import { describe, expect, it } from "vitest";
import { fixtureParts } from "./fixtures/demoSnapshot.fixture";
import { consultReducer, initialConsultState, type ConsultEvent } from "./state";
import {
  acceptedReviewSelection,
  createReviewSelectionStore,
  reviewSelectionReducer,
  type ReviewSelection,
} from "./reviewSelectionStore";
import type { Candidate, Survey } from "./types";

// Actual part rows are from the snapshot fixture. UNKNOWN is a reducer test input, not a product claim.
const product = fixtureParts.find(
  (part) => part.category === "cpu" && part.current_price !== null,
)!;
const survey: Survey = {
  mode: "new",
  budget: 2000000,
  purposes: ["other"],
  resolution: "fhd",
  frameRate: "60",
  workScale: "basic",
  problems: [],
  problemNote: "",
  owned: {},
};
const timestamp = "2026-11-20T01:00:00Z";
const unknown: Candidate = {
  part: product,
  recommended: false,
  reason: "전이 검사",
  validation: {
    status: "UNKNOWN",
    basis: "demo",
    checks: [
      { code: "test-unknown", status: "UNKNOWN", message: "검사에 필요한 값이 없습니다." },
      { code: "test-pass", status: "PASS", message: "통과 항목입니다." },
    ],
  },
};

function ready(candidate = unknown) {
  const started = consultReducer(initialConsultState(), {
    type: "START",
    consultationId: "selection-store-test",
    survey,
    plan: {
      steps: ["cpu"],
      allocations: {
        cpu: survey.budget,
        motherboard: 0,
        ram: 0,
        gpu: 0,
        storage: 0,
        cooler: 0,
        psu: 0,
        case: 0,
      },
      criteria: [],
      reasons: {},
    },
  });
  return consultReducer(consultReducer(started, { type: "REQUEST", requestId: 1 }), {
    type: "CANDIDATES",
    requestId: 1,
    result: {
      passed: candidate.validation.status === "PASS" ? [candidate] : [],
      needsReview: candidate.validation.status === "UNKNOWN" ? [candidate] : [],
      rejectedCount: 0,
      missingColorCount: 0,
      sortLabel: "테스트",
      criteria: [],
      basis: "demo",
    },
  });
}

function accepted(companyCode = "BW-1001"): ReviewSelection {
  const previous = ready();
  const event: ConsultEvent = { type: "SELECT", candidate: unknown, allowUnknown: true };
  return acceptedReviewSelection(
    companyCode,
    event,
    previous,
    consultReducer(previous, event),
    timestamp,
  )!;
}

describe("실제로 경고를 확인한 선택 이력", () => {
  it("records only an accepted UNKNOWN selection and copies the canonical product and unknown reasons", () => {
    const previous = ready();
    const event: ConsultEvent = {
      type: "SELECT",
      allowUnknown: true,
      candidate: {
        ...unknown,
        part: { ...product, name: "신뢰하지 않는 이벤트 이름" },
        validation: { status: "PASS", checks: [], basis: "demo" },
      },
    };
    const next = consultReducer(previous, event);
    const record = acceptedReviewSelection("BW-1001", event, previous, next, timestamp)!;
    expect(record.productName).toBe(product.name);
    expect(record.sourceKey).toBe(product.source_key);
    expect(record.reasons).toEqual(["검사에 필요한 값이 없습니다."]);
    expect(record.selectedAt).toBe(timestamp);
    expect(next.validations.cpu?.status).toBe("UNKNOWN");
  });

  it("does not record a cancelled warning, rejected stale SELECT, ordinary PASS or non-selection rerender", () => {
    const previous = ready();
    const denied: ConsultEvent = { type: "SELECT", candidate: unknown };
    expect(
      acceptedReviewSelection(
        "BW-1001",
        denied,
        previous,
        consultReducer(previous, denied),
        timestamp,
      ),
    ).toBeNull();
    const event: ConsultEvent = { ...denied, allowUnknown: true };
    expect(acceptedReviewSelection("BW-1001", event, previous, previous, timestamp)).toBeNull();
    const passing = { ...unknown, validation: { ...unknown.validation, status: "PASS" as const } };
    const passState = ready(passing);
    const passEvent: ConsultEvent = { type: "SELECT", candidate: passing, allowUnknown: true };
    expect(
      acceptedReviewSelection(
        "BW-1001",
        passEvent,
        passState,
        consultReducer(passState, passEvent),
        timestamp,
      ),
    ).toBeNull();
    expect(
      acceptedReviewSelection(
        "BW-1001",
        { type: "OPEN_BUDGET" },
        previous,
        { ...previous },
        timestamp,
      ),
    ).toBeNull();
    expect(
      acceptedReviewSelection(
        undefined,
        event,
        previous,
        consultReducer(previous, event),
        timestamp,
      ),
    ).toBeNull();
  });

  it("deduplicates company/consultation/category/source_key across duplicate callbacks and subscriptions", () => {
    const store = createReviewSelectionStore();
    const record = accepted();
    let renders = 0;
    const unsubscribe = store.subscribe(() => {
      renders += 1;
    });
    store.dispatch({ type: "SELECTED", selection: record });
    const snapshot = store.getSnapshot();
    store.dispatch({
      type: "SELECTED",
      selection: { ...record, selectedAt: "2026-11-20T02:00:00Z" },
    });
    expect(store.getSnapshot()).toBe(snapshot);
    expect(renders).toBe(1);
    unsubscribe();
    // A remounted subscriber reads the retained snapshot without adding a new selection.
    const unmountAgain = store.subscribe(() => {
      renders += 1;
    });
    expect(store.getSnapshot()).toHaveLength(1);
    expect(renders).toBe(1);
    unmountAgain();
  });

  it("keeps other companies on reset and starts empty on a fresh browser lifetime", () => {
    const store = createReviewSelectionStore();
    store.dispatch({ type: "SELECTED", selection: accepted("BW-1001") });
    store.dispatch({ type: "SELECTED", selection: accepted("BW-2002") });
    expect(store.getSnapshot()).toHaveLength(2);
    store.dispatch({ type: "RESET_COMPANY", companyCode: "BW-1001" });
    expect(store.getSnapshot().map((record) => record.companyCode)).toEqual(["BW-2002"]);
    expect(createReviewSelectionStore().getSnapshot()).toEqual([]);
  });

  it("leaves earlier history immutable and counts a different accepted product as a separate event", () => {
    const first = accepted();
    const state = reviewSelectionReducer([], { type: "SELECTED", selection: first });
    first.reasons.push("외부에서 바꾼 입력");
    expect(state[0].reasons).toHaveLength(1);
    const other = fixtureParts.find(
      (part) => part.category === "cpu" && part.source_key !== product.source_key,
    )!;
    const second = {
      ...state[0],
      sourceKey: other.source_key,
      productName: other.name,
      key: JSON.stringify(["BW-1001", first.consultationId, "cpu", other.source_key]),
    };
    expect(reviewSelectionReducer(state, { type: "SELECTED", selection: second })).toHaveLength(2);
    expect(state).toHaveLength(1);
  });
});
