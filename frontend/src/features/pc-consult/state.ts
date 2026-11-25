import { CATEGORIES, selectionLines, type FanSelection, type Part } from "./types";
import type {
  AccountKind,
  BudgetProposal,
  Candidate,
  CandidateResult,
  Category,
  ConsultMode,
  ConsultPlan,
  Progress,
  Quote,
  SaveReceipt,
  SelectionMap,
  Survey,
  ValidationResult,
} from "./types";

export type ConsultScreen =
  "start" | "type" | "survey" | "review" | "selection" | "budget" | "quote" | "saved" | "payment";

type ActivePlan = ConsultPlan & { fixedBudgetCategory?: Category };

export function categoryBudget(
  survey: Survey,
  plan: ActivePlan,
  selected: SelectionMap,
  category: Category,
) {
  const otherCost = selectionLines(selected)
    .filter(({ part }) => part.category !== category)
    .reduce((sum, { part, quantity }) => sum + (part.current_price ?? 0) * quantity, 0);
  const remaining = Math.max(0, survey.budget - otherCost);
  if (survey.mode === "replacement") return remaining;
  if (plan.fixedBudgetCategory === category) return Math.min(remaining, plan.allocations[category]);
  const reserve = plan.steps
    .filter((step) => step !== category && !selected[step])
    .reduce((sum, step) => sum + plan.allocations[step], 0);
  return Math.max(0, remaining - reserve);
}

export interface ConsultState {
  screen: ConsultScreen;
  demoPaymentCompleted: boolean;
  account: AccountKind;
  survey: Survey | null;
  plan: ActivePlan | null;
  consultationId: string;
  selected: SelectionMap;
  validations: Partial<Record<Category, ValidationResult>>;
  needsReview: Category[];
  stepIndex: number;
  awaitingSelection: boolean;
  candidates: CandidateResult | null;
  progress: Progress | null;
  requestId: number | null;
  error: string | null;
  quotes: Quote[];
  editingCategory: Category | null;
  conditions: { color: string; note: string };
  budgetProposal: BudgetProposal | null;
  quotePending: boolean;
  savePending: boolean;
  receipt: SaveReceipt | null;
  editBackup: {
    selected: SelectionMap;
    validations: Partial<Record<Category, ValidationResult>>;
    needsReview: Category[];
    plan: ActivePlan | null;
    receipt: SaveReceipt | null;
  } | null;
}

export type ConsultEvent =
  | { type: "ENTER"; account: AccountKind }
  | { type: "CHOOSE_MODE"; mode: ConsultMode }
  | { type: "SURVEY_REVIEW"; survey: Survey }
  | { type: "EDIT_SURVEY" }
  | { type: "START"; survey: Survey; plan: ConsultPlan; consultationId: string }
  | { type: "REQUEST"; requestId: number }
  | { type: "PROGRESS"; requestId: number; progress: Progress }
  | { type: "CANDIDATES"; requestId: number; result: CandidateResult }
  | { type: "ERROR"; requestId: number; message: string }
  | { type: "SELECT"; candidate: Candidate; allowUnknown?: boolean; fans?: FanSelection[] }
  | { type: "VISIT_STEP"; index: number }
  | { type: "OPEN_BUDGET" }
  | { type: "BUDGET_PROPOSAL"; proposal: BudgetProposal; amount?: number }
  | { type: "ACCEPT_BUDGET" }
  | { type: "REJECT_BUDGET" }
  | { type: "QUOTE_REQUEST"; requestId: number }
  | { type: "QUOTE_READY"; requestId: number; quote: Quote }
  | { type: "EDIT_QUOTE"; category: Category; color?: string; note?: string }
  | { type: "SET_CONDITIONS"; color: string; note: string }
  | { type: "CANCEL_EDIT" }
  | { type: "CONFIRM_REQUEST"; requestId: number }
  | { type: "CONFIRMED"; requestId: number; receipt: SaveReceipt }
  | { type: "PAYMENT" }
  | { type: "COMPLETE_DEMO_PAYMENT" }
  | { type: "VIEW_QUOTE" }
  | { type: "SHOW_SAVED" }
  | { type: "RESTART" };

export function initialConsultState(): ConsultState {
  return {
    screen: "start",
    demoPaymentCompleted: false,
    account: "personal",
    survey: null,
    plan: null,
    consultationId: "",
    selected: {},
    validations: {},
    needsReview: [],
    stepIndex: 0,
    awaitingSelection: true,
    candidates: null,
    progress: null,
    requestId: null,
    error: null,
    quotes: [],
    editingCategory: null,
    conditions: { color: "", note: "" },
    budgetProposal: null,
    quotePending: false,
    savePending: false,
    receipt: null,
    editBackup: null,
  };
}

export function currentCategory(state: ConsultState): Category | null {
  return state.editingCategory ?? state.plan?.steps[state.stepIndex] ?? null;
}

export function selectedTotal(state: ConsultState): number {
  return selectionLines(state.selected).reduce(
    (total, { part, quantity }) => total + (part.current_price ?? 0) * quantity,
    0,
  );
}

export function remainingBudget(state: ConsultState): number {
  return (state.survey?.budget ?? 0) - selectedTotal(state);
}

export function currentQuote(state: ConsultState): Quote | null {
  return state.quotes.at(-1) ?? null;
}

export function isSelectionComplete(state: ConsultState): boolean {
  return Boolean(
    state.plan?.steps.length &&
    !state.awaitingSelection &&
    state.needsReview.length === 0 &&
    state.plan.steps.every((category) => state.selected[category]),
  );
}

function blankSurvey(mode: ConsultMode): Survey {
  return {
    mode,
    budget: 1500000,
    purposes: [],
    resolution: "fhd",
    frameRate: "60",
    workScale: "basic",
    problems: [],
    problemNote: "",
    owned: {},
  };
}

function withoutRequest(state: ConsultState): ConsultState {
  return {
    ...state,
    requestId: null,
    progress: null,
    error: null,
    quotePending: false,
    savePending: false,
  };
}

function copyQuote(quote: Quote): Quote {
  return {
    ...quote,
    items: quote.items.map((item) => ({ ...item })),
    validation: {
      ...quote.validation,
      checks: quote.validation.checks.map((check) => ({ ...check })),
    },
    ...(quote.reviewItems
      ? { reviewItems: quote.reviewItems.map((item) => ({ ...item, reasons: [...item.reasons] })) }
      : {}),
  };
}

/** Keep acknowledged unknowns on this exact quote version, including after saving. */
function quoteWithSelectionReviews(state: ConsultState, quote: Quote): Quote {
  const reviewItems = quote.items.flatMap((item) => {
    const supplied = quote.reviewItems?.find((review) => review.source_key === item.source_key);
    const selected = state.selected[item.category];
    const validation = state.validations[item.category];
    const selectedReasons =
      selected?.source_key === item.source_key && validation?.status === "UNKNOWN"
        ? validation.checks
            .filter((check) => check.status === "UNKNOWN")
            .map((check) => check.message)
        : [];
    const reasons = [...new Set([...(supplied?.reasons ?? []), ...selectedReasons])];
    return reasons.length
      ? [{ source_key: item.source_key, category: item.category, reasons }]
      : [];
  });
  return copyQuote({ ...quote, ...(reviewItems.length ? { reviewItems } : {}) });
}

function quoteMatchesSelection(state: ConsultState, quote: Quote): boolean {
  const parts = selectionLines(state.selected);
  return (
    quote.consultation_id === state.consultationId &&
    quote.total_amount === selectedTotal(state) &&
    quote.items.length === parts.length &&
    parts.every(({ part, quantity }) =>
      quote.items.some(
        (item) =>
          item.source_key === part.source_key &&
          item.category === part.category &&
          item.unit_price === part.current_price &&
          item.quantity === quantity,
      ),
    )
  );
}

/** Local UI events only. Domain decisions and asynchronous work belong to ConsultDataSource. */
export function consultReducer(state: ConsultState, event: ConsultEvent): ConsultState {
  switch (event.type) {
    case "ENTER":
      return { ...withoutRequest(state), screen: "type", account: event.account };
    case "CHOOSE_MODE":
      return {
        ...initialConsultState(),
        account: state.account,
        screen: "survey",
        survey: blankSurvey(event.mode),
      };
    case "SURVEY_REVIEW":
      return { ...withoutRequest(state), screen: "review", survey: event.survey };
    case "EDIT_SURVEY":
      return { ...withoutRequest(state), screen: "survey" };
    case "START":
      return {
        ...initialConsultState(),
        account: state.account,
        screen: "selection",
        consultationId: event.consultationId,
        survey: event.survey,
        plan: {
          ...event.plan,
          steps: [...event.plan.steps],
          allocations: { ...event.plan.allocations },
        },
        error: event.plan.steps.length
          ? null
          : "교체할 부품을 정하지 못했습니다. 설문을 확인해 주세요.",
      };
    case "REQUEST":
      if (state.screen !== "selection" && state.screen !== "budget") return state;
      return {
        ...withoutRequest(state),
        requestId: event.requestId,
        candidates: null,
        progress: { phase: "loading", completed: 0, total: 0 },
      };
    case "PROGRESS":
      if (state.requestId !== event.requestId || state.quotePending || state.savePending)
        return state;
      return { ...state, progress: event.progress };
    case "CANDIDATES":
      if (state.requestId !== event.requestId || state.quotePending || state.savePending)
        return state;
      return {
        ...state,
        candidates: event.result,
        requestId: null,
        progress: {
          phase: "ready",
          completed:
            event.result.passed.length +
            event.result.needsReview.length +
            event.result.rejectedCount,
          total:
            event.result.passed.length +
            event.result.needsReview.length +
            event.result.rejectedCount,
        },
        error: null,
      };
    case "ERROR":
      if (state.requestId !== event.requestId) return state;
      return { ...withoutRequest(state), error: event.message };
    case "SELECT": {
      const category = currentCategory(state);
      if (!category || !state.plan || state.screen !== "selection" || state.requestId !== null)
        return state;
      const candidate = [
        ...(state.candidates?.passed ?? []),
        ...(state.candidates?.needsReview ?? []),
      ].find(
        (entry) =>
          entry.part.source_key === event.candidate.part.source_key &&
          entry.part.category === category,
      );
      if (
        !candidate ||
        candidate.part.current_price === null ||
        candidate.validation.status === "FAIL"
      )
        return state;
      if (candidate.validation.status === "UNKNOWN" && !event.allowUnknown) return state;
      let part: Part = candidate.part;
      if (category === "cooler" && event.fans) {
        const fans: FanSelection[] = [];
        for (const line of event.fans) {
          const fan = state.candidates?.fans?.find((p) => p.part_id === line.part.part_id);
          if (
            !fan ||
            !Number.isInteger(line.quantity) ||
            line.quantity < 1 ||
            line.quantity > 32 ||
            fans.some((entry) => entry.part.part_id === fan.part_id)
          )
            return state;
          fans.push({ part: fan, quantity: line.quantity });
        }
        part = { ...part, cooling: { mode: candidate.cooling_mode ?? "purchase", fans } };
      }
      const previous = state.selected[category];
      const changed =
        previous?.source_key !== part.source_key ||
        JSON.stringify(previous?.cooling) !== JSON.stringify(part.cooling);
      const selected = { ...state.selected, [category]: part };
      const needsReview = new Set(state.needsReview.filter((entry) => entry !== category));
      if (changed && !state.editingCategory) {
        for (const later of state.plan.steps.slice(state.stepIndex + 1)) {
          if (selected[later]) needsReview.add(later);
        }
      }
      const nextIndex = state.editingCategory
        ? -1
        : state.plan.steps.findIndex((entry) => !selected[entry] || needsReview.has(entry));
      return {
        ...withoutRequest(state),
        selected,
        validations: { ...state.validations, [category]: candidate.validation },
        needsReview: [...needsReview],
        stepIndex: nextIndex === -1 ? state.stepIndex : nextIndex,
        awaitingSelection: nextIndex !== -1,
        candidates: null,
        receipt: null,
      };
    }
    case "VISIT_STEP": {
      if (
        !state.plan ||
        state.savePending ||
        event.index < 0 ||
        event.index >= state.plan.steps.length
      )
        return state;
      if (
        state.screen === "selection" &&
        state.awaitingSelection &&
        !state.editingCategory &&
        event.index === state.stepIndex
      )
        return state;
      // A user can revisit completed steps or the first unfinished step, never skip unfinished work.
      const firstUnselected = state.plan.steps.findIndex((category) => !state.selected[category]);
      if (firstUnselected !== -1 && event.index > firstUnselected) return state;
      return {
        ...withoutRequest(state),
        screen: "selection",
        stepIndex: event.index,
        awaitingSelection: true,
        candidates: null,
        editingCategory: null,
        conditions: { color: "", note: "" },
      };
    }
    case "OPEN_BUDGET":
      if (state.survey?.mode !== "new" || state.screen !== "selection") return state;
      return { ...withoutRequest(state), screen: "budget", budgetProposal: null };
    case "BUDGET_PROPOSAL":
      if (state.screen !== "budget") return state;
      return { ...state, budgetProposal: event.proposal };
    case "ACCEPT_BUDGET": {
      if (!state.budgetProposal || !state.plan || state.screen !== "budget") return state;
      const selected = { ...state.selected };
      const validations = { ...state.validations };
      let earliestChange = state.plan.steps.length;
      for (const alternative of state.budgetProposal.alternatives) {
        if (selected[alternative.category]?.source_key !== alternative.before.source_key)
          return state;
        if (alternative.validation.status === "FAIL") return state;
        selected[alternative.category] = alternative.after;
        validations[alternative.category] = alternative.validation;
        earliestChange = Math.min(earliestChange, state.plan.steps.indexOf(alternative.category));
      }
      const needsReview = new Set(state.needsReview);
      // Quote changes validate the complete revised configuration through createQuote.
      // Sequential revisits must instead reselect each affected later step.
      if (!state.editingCategory) {
        for (const category of state.plan.steps.slice(earliestChange + 1)) {
          if (selected[category]) needsReview.add(category);
        }
      }
      const earliestReview = state.plan.steps.findIndex((category) => needsReview.has(category));
      return {
        ...withoutRequest(state),
        screen: "selection",
        selected,
        validations,
        needsReview: [...needsReview],
        plan: {
          ...state.plan,
          allocations: { ...state.budgetProposal.allocations },
          fixedBudgetCategory: currentCategory(state) ?? undefined,
        },
        budgetProposal: null,
        candidates: null,
        stepIndex:
          earliestReview === -1 ? state.stepIndex : Math.min(earliestReview, state.stepIndex),
        awaitingSelection: true,
        receipt: null,
      };
    }
    case "REJECT_BUDGET":
      if (state.screen !== "budget") return state;
      return {
        ...withoutRequest(state),
        screen: "selection",
        budgetProposal: null,
        candidates: null,
      };
    case "QUOTE_REQUEST":
      if (!isSelectionComplete(state) || state.quotePending || state.savePending) return state;
      return { ...withoutRequest(state), requestId: event.requestId, quotePending: true };
    case "QUOTE_READY": {
      if (state.requestId !== event.requestId || !state.quotePending || !isSelectionComplete(state))
        return state;
      if (
        event.quote.version !== (currentQuote(state)?.version ?? 0) + 1 ||
        event.quote.status !== "DRAFT" ||
        !quoteMatchesSelection(state, event.quote)
      ) {
        return {
          ...withoutRequest(state),
          error: "현재 선택과 견적이 다릅니다. 견적을 다시 만들어 주세요.",
        };
      }
      return {
        ...withoutRequest(state),
        screen: "quote",
        quotes: [...state.quotes, quoteWithSelectionReviews(state, event.quote)],
        editingCategory: null,
        editBackup: null,
        conditions: { color: "", note: "" },
        receipt: null,
      };
    }
    case "EDIT_QUOTE":
      if (!currentQuote(state) || !state.selected[event.category] || state.savePending)
        return state;
      return {
        ...withoutRequest(state),
        screen: "selection",
        editingCategory: event.category,
        stepIndex: state.plan?.steps.indexOf(event.category) ?? 0,
        conditions: { color: event.color ?? "", note: event.note ?? "" },
        awaitingSelection: true,
        candidates: null,
        editBackup: {
          selected: { ...state.selected },
          validations: { ...state.validations },
          needsReview: [...state.needsReview],
          plan: state.plan ? { ...state.plan, allocations: { ...state.plan.allocations } } : null,
          receipt: state.receipt,
        },
      };
    case "SET_CONDITIONS":
      return {
        ...withoutRequest(state),
        conditions: { color: event.color, note: event.note },
        candidates: null,
      };
    case "CANCEL_EDIT":
      if (!state.editBackup || !currentQuote(state)) return state;
      return {
        ...withoutRequest(state),
        ...state.editBackup,
        screen: "quote",
        awaitingSelection: false,
        editingCategory: null,
        editBackup: null,
        candidates: null,
        conditions: { color: "", note: "" },
      };
    case "CONFIRM_REQUEST": {
      const quote = currentQuote(state);
      if (
        state.screen !== "quote" ||
        !quote ||
        quote.status !== "DRAFT" ||
        quote.validation.status === "FAIL" ||
        state.savePending ||
        state.quotePending ||
        !isSelectionComplete(state) ||
        !quoteMatchesSelection(state, quote)
      )
        return state;
      return { ...withoutRequest(state), requestId: event.requestId, savePending: true };
    }
    case "CONFIRMED": {
      const quote = currentQuote(state);
      if (
        state.requestId !== event.requestId ||
        !state.savePending ||
        !quote ||
        event.receipt.quote.version !== quote.version ||
        event.receipt.quote.status !== "CONFIRMED" ||
        !quoteMatchesSelection(state, event.receipt.quote)
      )
        return state;
      const savedQuote = copyQuote({
        ...event.receipt.quote,
        ...(quote.reviewItems ? { reviewItems: quote.reviewItems } : {}),
      });
      return {
        ...withoutRequest(state),
        screen: event.receipt.storage === "session" ? "payment" : "saved",
        quotes: state.quotes.map((previous) =>
          previous.version === quote.version ? savedQuote : previous,
        ),
        receipt: { ...event.receipt, quote: savedQuote },
      };
    }
    case "PAYMENT":
      if (!state.receipt || currentQuote(state)?.status !== "CONFIRMED" || state.screen !== "saved")
        return state;
      return { ...state, screen: "payment" };
    case "COMPLETE_DEMO_PAYMENT":
      if (state.screen !== "payment" || state.receipt?.quote.status !== "CONFIRMED") return state;
      return {
        ...initialConsultState(),
        screen: "type",
        account: state.account,
        demoPaymentCompleted: true,
      };
    case "VIEW_QUOTE":
      if (!currentQuote(state) || state.savePending) return state;
      return { ...withoutRequest(state), screen: "quote" };
    case "SHOW_SAVED": {
      const quote = currentQuote(state);
      if (
        !quote ||
        quote.status !== "CONFIRMED" ||
        !state.receipt ||
        state.receipt.quote.version !== quote.version ||
        state.receipt.quote.consultation_id !== quote.consultation_id ||
        !quoteMatchesSelection(state, quote) ||
        !isSelectionComplete(state) ||
        state.savePending
      )
        return state;
      return { ...withoutRequest(state), screen: "saved" };
    }
    case "RESTART":
      return initialConsultState();
  }
}

/** Display order of component categories during a new PC consultation. */
export const NEW_BUILD_STEPS: readonly Category[] = CATEGORIES;
