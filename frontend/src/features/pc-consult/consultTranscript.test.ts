import { describe, expect, it } from "vitest";
import { initialChatState } from "../chat/chatState";
import {
  appendConsultMessage,
  appendConsultTransition,
  initialConsultChatState,
} from "./consultTranscript";
import { fixtureParts } from "./fixtures/demoSnapshot.fixture";
import { consultReducer, initialConsultState, type ConsultEvent, type ConsultState } from "./state";
import {
  CATEGORIES,
  type Candidate,
  type CandidateResult,
  type ConsultPlan,
  type Quote,
  type Survey,
} from "./types";

const now = "2026-11-18T12:34:56Z";
const survey: Survey = {
  mode: "new",
  budget: 2000000,
  purposes: ["gaming"],
  resolution: "qhd",
  frameRate: "144",
  workScale: "basic",
  problems: [],
  problemNote: "",
  owned: {},
};
const plan: ConsultPlan = {
  steps: ["cpu"],
  reasons: {},
  allocations: Object.fromEntries(
    CATEGORIES.map((category) => [category, 250000]),
  ) as ConsultPlan["allocations"],
  criteria: [],
};
const part = fixtureParts.find((row) => row.source_key === "amd-ryzen-5-7600")!;
const candidate: Candidate = {
  part,
  validation: { status: "PASS", checks: [], basis: "demo" },
  recommended: true,
  reason: "테스트 이벤트",
};
function readyToSelect(): ConsultState {
  let state = consultReducer(initialConsultState(), {
    type: "START",
    survey,
    plan,
    consultationId: "transcript-demo",
  });
  state = consultReducer(state, { type: "REQUEST", requestId: 1 });
  const result: CandidateResult = {
    passed: [candidate],
    needsReview: [],
    rejectedCount: 0,
    missingColorCount: 0,
    sortLabel: "가격 낮은 순",
    criteria: [],
    basis: "demo",
  };
  return consultReducer(state, { type: "CANDIDATES", requestId: 1, result });
}
function quoteState(): ConsultState {
  let state = consultReducer(readyToSelect(), { type: "SELECT", candidate });
  const quote: Quote = {
    quote_id: `${state.consultationId}/1`,
    consultation_id: state.consultationId,
    version: 1,
    status: "DRAFT",
    currency: "KRW",
    total_amount: part.current_price!,
    created_at: now,
    items: [
      {
        part_id: part.part_id,
        source_key: part.source_key,
        category: part.category,
        part_name_snapshot: part.name,
        unit_price: part.current_price!,
        quantity: 1,
        price_checked_at: part.price_checked_at,
      },
    ],
    validation: candidate.validation,
  };
  state = consultReducer(state, { type: "QUOTE_REQUEST", requestId: 2 });
  return consultReducer(state, { type: "QUOTE_READY", requestId: 2, quote });
}
const transition = (state: ConsultState, event: ConsultEvent) =>
  appendConsultTransition(initialChatState(), event, state, consultReducer(state, event), now);

describe("PC consultation transcript bridge", () => {
  it("creates local welcome dialogue with no invented NLU or quick replies", () => {
    const chat = initialConsultChatState(now);
    expect(chat.messages).toHaveLength(1);
    expect(chat.messages[0]).toMatchObject({
      id: 1,
      role: "assistant",
      nlu: null,
      quick_replies: [],
      created_at: now,
    });
    expect(chat.messages[0].content).toContain("시연");
    expect(initialConsultChatState().messages[0].created_at).toBe("");
  });
  it("appends only a memo and transparent guidance for typed or transcribed speech", () => {
    const chat = initialConsultChatState(now);
    const result = appendConsultMessage(chat, "  흰색 케이스로 바꿔 주세요.  ", now);
    expect(result.messages.slice(-2).map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(result.messages.at(-2)!.content).toBe("흰색 케이스로 바꿔 주세요.");
    expect(result.messages.at(-1)!.content).toContain("아래 선택 항목에서 반영");
    expect(result.messages.at(-1)!.content).toContain("견적이 바뀌지 않습니다");
    expect(result.messages.every((message) => message.nlu === null)).toBe(true);
    expect(chat.messages).toHaveLength(1);
    expect(appendConsultMessage(chat, " \n ", now)).toBe(chat);
  });
  it("uses deterministic increasing IDs without modifying earlier messages", () => {
    const chat = initialConsultChatState(now);
    const first = appendConsultMessage(chat, "요청 메모", now);
    const second = appendConsultMessage(first, "추가 메모", now);
    expect(second.messages.map((message) => message.id)).toEqual([1, 2, 3, 4, 5]);
    expect(appendConsultMessage(first, "추가 메모", now)).toEqual(second);
    expect(second.messages[0]).toBe(chat.messages[0]);
  });
  it("records actual mode and survey choices in Korean", () => {
    const mode = transition(initialConsultState(), { type: "CHOOSE_MODE", mode: "new" });
    expect(mode.messages[0].content).toContain("새 PC");
    const form = transition(initialConsultState(), { type: "SURVEY_REVIEW", survey });
    expect(form.messages[0].content).toContain("₩2,000,000");
    expect(form.messages[0].content).toContain("고사양 게임");
    expect(form.messages[0].content).toContain("QHD · 144프레임");
  });
  it("records manual owned parts as unverified in the replacement survey", () => {
    const input: Survey = {
      ...survey,
      mode: "replacement",
      problems: ["gaming"],
      owned: { gpu: { category: "gpu", name: "직접 입력한 GPU", part: null } },
    };
    const chat = transition(initialConsultState(), { type: "SURVEY_REVIEW", survey: input });
    expect(chat.messages[0].content).toContain("직접 입력한 GPU (미확인)");
    expect(chat.messages[0].content).toContain("게임이 끊겨요");
  });
  it("does not append rejected or stale events or worker progress", () => {
    const chat = initialConsultChatState(now);
    const state = readyToSelect();
    const rejected: ConsultEvent[] = [
      { type: "CONFIRM_REQUEST", requestId: 99 },
      { type: "PROGRESS", requestId: 999, progress: { phase: "ready", completed: 9, total: 9 } },
      { type: "VISIT_STEP", index: 99 },
    ];
    for (const event of rejected)
      expect(appendConsultTransition(chat, event, state, consultReducer(state, event), now)).toBe(
        chat,
      );
    const request: ConsultEvent = { type: "REQUEST", requestId: 3 };
    const requested = consultReducer(state, request);
    expect(appendConsultTransition(chat, request, state, requested, now)).toBe(chat);
    const progress: ConsultEvent = {
      type: "PROGRESS",
      requestId: 3,
      progress: { phase: "validation", completed: 1, total: 8 },
    };
    expect(
      appendConsultTransition(chat, progress, requested, consultReducer(requested, progress), now),
    ).toBe(chat);
  });
  it("reports only the canonical accepted product and remaining budget", () => {
    const chat = transition(readyToSelect(), {
      type: "SELECT",
      candidate: { ...candidate, part: { ...part, name: "주입하면 안 되는 제품명" } },
    });
    expect(chat.messages[0].content).toContain(part.name);
    expect(chat.messages[0].content).not.toContain("주입하면");
    expect(chat.messages[1].content).toContain("₩1,731,749");
    expect(chat.messages.every((message) => message.session_id === "transcript-demo")).toBe(true);
  });
  it("does not record unacknowledged unknown selection as a choice", () => {
    const unknown: Candidate = {
      ...candidate,
      validation: { status: "UNKNOWN", checks: [], basis: "demo" },
      recommended: false,
    };
    const state = {
      ...readyToSelect(),
      candidates: { ...readyToSelect().candidates!, passed: [], needsReview: [unknown] },
    };
    expect(transition(state, { type: "SELECT", candidate: unknown }).messages).toHaveLength(0);
    expect(
      transition(state, { type: "SELECT", candidate: unknown, allowUnknown: true }).messages[0]
        .content,
    ).toContain("확인 불가 경고");
  });
  it("keeps proposal preview distinct from accepted budget changes", () => {
    const state = consultReducer(readyToSelect(), { type: "OPEN_BUDGET" });
    const event: ConsultEvent = {
      type: "BUDGET_PROPOSAL",
      proposal: {
        alternatives: [],
        beforeTotal: 2000000,
        afterTotal: 2000000,
        allocations: { ...plan.allocations, cpu: 500000 },
        feasible: true,
        explanation: "테스트 배분안",
      },
    };
    const proposed = consultReducer(state, event);
    const preview = appendConsultTransition(initialChatState(), event, state, proposed, now);
    expect(preview.messages[0].content).toContain("₩500,000");
    expect(preview.messages[1].content).toContain("아직 기존 선택이나 배정 금액");
    expect(transition(proposed, { type: "ACCEPT_BUDGET" }).messages[1].content).toContain(
      "반영했습니다",
    );
    expect(transition(proposed, { type: "REJECT_BUDGET" }).messages[0].content).toContain("취소");
  });
  it("records edit and cancellation without inventing a new quote version", () => {
    const state = quoteState();
    const event: ConsultEvent = {
      type: "EDIT_QUOTE",
      category: "cpu",
      color: "흰색",
      note: "요청 메모",
    };
    const editing = consultReducer(state, event);
    expect(
      appendConsultTransition(initialChatState(), event, state, editing, now).messages[0].content,
    ).toContain("CPU 변경");
    const cancelled = transition(editing, { type: "CANCEL_EDIT" });
    expect(cancelled.messages[1].content).toContain("기존 견적");
    expect(cancelled.messages[1].content).not.toContain("v2");
  });
  it("never claims saved until the accepted confirmation receipt arrives", () => {
    const state = quoteState();
    const request: ConsultEvent = { type: "CONFIRM_REQUEST", requestId: 3 };
    const pending = consultReducer(state, request);
    const requested = appendConsultTransition(initialChatState(), request, state, pending, now);
    expect(requested.messages).toHaveLength(1);
    expect(requested.messages[0].role).toBe("user");
    expect(requested.messages[0].content).not.toContain("저장했습니다");
    const event: ConsultEvent = {
      type: "CONFIRMED",
      requestId: 3,
      receipt: {
        quote: { ...state.quotes[0], status: "CONFIRMED" },
        storage: "memory",
        message: "시연 저장",
      },
    };
    const result = appendConsultTransition(
      requested,
      event,
      pending,
      consultReducer(pending, event),
      now,
    );
    expect(result.messages.at(-1)!.content).toContain("시연 저장했습니다");
    expect(result.messages.at(-1)!.content).toContain("DB에 기록되지 않으며");
  });
  it("does not describe a rejected quote payload as a prepared quote", () => {
    const complete = consultReducer(readyToSelect(), { type: "SELECT", candidate });
    const pending = consultReducer(complete, { type: "QUOTE_REQUEST", requestId: 8 });
    const event: ConsultEvent = {
      type: "QUOTE_READY",
      requestId: 8,
      quote: { ...quoteState().quotes[0], total_amount: 1 },
    };
    const rejected = consultReducer(pending, event);
    expect(rejected).not.toBe(pending);
    expect(rejected.error).toBeTruthy();
    expect(
      appendConsultTransition(initialChatState(), event, pending, rejected, now).messages,
    ).toHaveLength(0);
  });
});
