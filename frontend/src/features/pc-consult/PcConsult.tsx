import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { ConsultDataSource } from "./data/ConsultDataSource";
import { ReviewScreen, SurveyScreen, TypeScreen } from "./components/SurveyScreen";
import { CandidateScreen } from "./components/CandidateScreen";
import { BudgetScreen } from "./components/BudgetScreen";
import { PaymentScreen, QuoteScreen, SavedScreen } from "./components/QuoteScreen";
import { SummaryPanel } from "./components/SummaryPanel";
import {
  consultReducer,
  currentCategory,
  currentQuote,
  initialConsultState,
  isSelectionComplete,
  type ConsultEvent,
} from "./state";
import { CATEGORY_LABELS, type CandidateRequest, type Survey } from "./types";
import "./pcConsult.css";
export function PcConsult({
  source,
  sessionId,
  onContext,
  renderLayout,
}: {
  source: ConsultDataSource;
  sessionId: string;
  onContext: (survey: Survey | null, selected: import("./types").SelectionMap) => void;
  renderLayout: (content: ReactNode, intake: boolean) => ReactNode;
}) {
  const [state, dispatch] = useReducer(consultReducer, undefined, () =>
    consultReducer(initialConsultState(), { type: "ENTER", account: "personal" }),
  );
  const deliver = useCallback(async (event: ConsultEvent) => dispatch(event), []);
  const [draft, setDraft] = useState<Survey | null>(null);
  useEffect(
    () => onContext(state.plan ? state.survey : null, state.selected),
    [onContext, state.plan, state.survey, state.selected],
  );
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  const [retry, setRetry] = useState(0);
  const [quoteRetry, setQuoteRetry] = useState(0);
  const requestSequence = useRef(0);
  const saving = useRef(false);
  const content = useRef<HTMLDivElement>(null);
  const lastFocus = useRef<string | null>(null);
  const budgetSource = useMemo<ConsultDataSource>(() => {
    if (state.screen !== "budget") return source;
    // Each visit owns its preview request; a cancelled preview cannot reuse a newer visit's ID.
    let budgetRequestId: number | null = null;
    return {
      ...source,
      async rebalance(input, amount) {
        const requestId = ++requestSequence.current;
        budgetRequestId = requestId;
        dispatch({ type: "REQUEST", requestId });
        dispatch({
          type: "PROGRESS",
          requestId,
          progress: { phase: "design", completed: 0, total: 0 },
        });
        try {
          return await source.rebalance(input, amount);
        } catch (error) {
          dispatch({
            type: "ERROR",
            requestId,
            message: error instanceof Error ? error.message : "예산을 나누지 못했습니다.",
          });
          throw error;
        }
      },
      async getCandidates(input, onProgress) {
        const requestId = budgetRequestId ?? ++requestSequence.current;
        try {
          const result = await source.getCandidates(input, (progress) => {
            dispatch({ type: "PROGRESS", requestId, progress });
            onProgress?.(progress);
          });
          await deliver({ type: "CANDIDATES", requestId, result });
          return result;
        } catch (error) {
          dispatch({
            type: "ERROR",
            requestId,
            message: error instanceof Error ? error.message : "새 후보를 불러오지 못했습니다.",
          });
          throw error;
        }
      },
    };
  }, [source, dispatch, deliver, state.screen]);
  const category = currentCategory(state);
  const complete = isSelectionComplete(state);
  const quote = currentQuote(state);
  const request = useMemo<CandidateRequest | null>(() => {
    if (!state.survey || !state.plan || !category) return null;
    // Ordinary steps may replace the later configuration; quote edits preserve it.
    const selected =
      state.survey.mode === "new" && !state.editingCategory
        ? Object.fromEntries(
            Object.entries(state.selected).filter(([key]) =>
              state.plan!.steps.slice(0, state.stepIndex + 1).includes(key as typeof category),
            ),
          )
        : state.selected;
    const otherCost = Object.values(selected)
      .filter((part) => part.category !== category)
      .reduce((sum, part) => sum + (part.current_price ?? 0), 0);
    const remaining = Math.max(0, state.survey.budget - otherCost);
    return {
      survey: state.survey,
      category,
      selected,
      budget:
        state.survey.mode === "replacement"
          ? remaining
          : Math.min(state.plan.allocations[category], remaining),
      color: state.conditions.color,
      note: state.conditions.note,
    };
  }, [
    state.survey,
    state.plan,
    state.selected,
    state.conditions,
    state.editingCategory,
    state.stepIndex,
    category,
  ]);

  useEffect(() => {
    if (state.screen !== "selection" || !state.awaitingSelection || !request) return;
    const requestId = ++requestSequence.current;
    let active = true;
    dispatch({ type: "REQUEST", requestId });
    source
      .getCandidates(request, (progress) => {
        if (active) dispatch({ type: "PROGRESS", requestId, progress });
      })
      .then(
        (result) => {
          if (active) void deliver({ type: "CANDIDATES", requestId, result });
        },
        (failure: unknown) => {
          if (active)
            dispatch({
              type: "ERROR",
              requestId,
              message: failure instanceof Error ? failure.message : "후보를 불러오지 못했습니다.",
            });
        },
      );
    return () => {
      active = false;
    };
  }, [source, request, state.screen, state.awaitingSelection, retry, dispatch, deliver]);

  useEffect(() => {
    if (state.screen !== "selection" || !complete || !state.survey) return;
    const requestId = ++requestSequence.current;
    let active = true;
    dispatch({ type: "QUOTE_REQUEST", requestId });
    source
      .createQuote({
        consultationId: state.consultationId,
        version: state.quotes.length + 1,
        survey: state.survey,
        selected: state.selected,
      })
      .then(
        (result) => {
          if (active) void deliver({ type: "QUOTE_READY", requestId, quote: result });
        },
        (failure: unknown) => {
          if (active)
            dispatch({
              type: "ERROR",
              requestId,
              message: failure instanceof Error ? failure.message : "견적을 만들지 못했습니다.",
            });
        },
      );
    return () => {
      active = false;
    };
  }, [
    source,
    complete,
    state.screen,
    state.survey,
    state.consultationId,
    state.selected,
    state.quotes.length,
    quoteRetry,
    dispatch,
    deliver,
  ]);

  useEffect(() => {
    const position = `${state.screen}:${category ?? ""}`;
    if (lastFocus.current !== null && lastFocus.current !== position)
      content.current?.scrollIntoView({ block: "start" });
    content.current?.focus({ preventScroll: true });
    lastFocus.current = position;
  }, [state.screen, category]);

  async function start() {
    if (!state.survey || starting) return;
    setStarting(true);
    setStartError("");
    try {
      const plan = await source.planConsultation(state.survey);
      dispatch({ type: "START", survey: state.survey, plan, consultationId: sessionId });
    } catch (failure) {
      setStartError(failure instanceof Error ? failure.message : "상담을 준비하지 못했습니다.");
    } finally {
      setStarting(false);
    }
  }
  async function confirm(acceptConditions: boolean) {
    if (!quote || saving.current) return;
    saving.current = true;
    const requestId = ++requestSequence.current;
    dispatch({ type: "CONFIRM_REQUEST", requestId });
    try {
      const receipt = await source.confirmQuote({
        quote_id: quote.quote_id,
        version: quote.version,
        acceptConditions,
      });
      await deliver({ type: "CONFIRMED", requestId, receipt });
    } catch (failure) {
      dispatch({
        type: "ERROR",
        requestId,
        message:
          failure instanceof Error
            ? failure.message
            : "견적을 저장하지 못했습니다. 다시 시도해 주세요.",
      });
    } finally {
      saving.current = false;
    }
  }
  function editSurvey() {
    setDraft(state.survey);
    setStartError("");
    dispatch({ type: "EDIT_SURVEY" });
  }
  function back() {
    if (state.editingCategory) dispatch({ type: "CANCEL_EDIT" });
    else if (state.stepIndex > 0) dispatch({ type: "VISIT_STEP", index: state.stepIndex - 1 });
    else editSurvey();
  }
  const showSteps =
    state.plan && ["selection", "budget", "quote", "saved", "payment"].includes(state.screen);
  const showSummary = state.survey && state.plan && ["selection", "budget"].includes(state.screen);
  const phaseIndex = ["start", "type"].includes(state.screen)
    ? 0
    : ["survey", "review"].includes(state.screen)
      ? 1
      : ["selection", "budget"].includes(state.screen)
        ? 2
        : 3;
  const screen = (
    <div className="pc-app pc-embedded">
      <a className="pc-skip" href="#pc-main-content">
        본문으로 건너뛰기
      </a>
      {state.screen !== "start" && (
        <nav className="pc-journey" aria-label="상담 진행 단계">
          {["상담 선택", "요구사항 작성", "부품 구성", "견적 · 승인"].map((label, index) => (
            <div
              key={label}
              className={index === phaseIndex ? "pc-current" : index < phaseIndex ? "pc-done" : ""}
              aria-current={index === phaseIndex ? "step" : undefined}
            >
              <span>{index < phaseIndex ? "✓" : `0${index + 1}`}</span>
              {label}
            </div>
          ))}
        </nav>
      )}
      <div className={`pc-main${state.screen === "start" ? " pc-main-start" : ""}`}>
        {showSteps && (
          <nav className="pc-steps" aria-label="부품 구성 순서">
            {state.plan!.steps.map((step, index) => {
              const stale = state.needsReview.includes(step);
              const selected = Boolean(state.selected[step]);
              return (
                <button
                  type="button"
                  key={step}
                  className={`${step === category && state.screen === "selection" ? "pc-current" : ""}${selected ? " pc-selected" : ""}${stale ? " pc-stale" : ""}`}
                  aria-current={
                    step === category && state.screen === "selection" ? "step" : undefined
                  }
                  disabled={
                    state.screen !== "selection" ||
                    state.quotePending ||
                    Boolean(state.editingCategory) ||
                    (!selected && index !== state.stepIndex)
                  }
                  onClick={() => dispatch({ type: "VISIT_STEP", index })}
                >
                  <span>{stale ? "!" : selected ? "✓" : index + 1}</span>
                  {CATEGORY_LABELS[step]}
                  {stale && <small>다시 확인 필요</small>}
                </button>
              );
            })}
          </nav>
        )}
        <div className={showSummary ? "pc-workspace" : "pc-single"}>
          <div id="pc-main-content" className="pc-content" tabIndex={-1} ref={content}>
            {state.screen === "type" && (
              <TypeScreen
                onChoose={(mode) => {
                  setDraft(null);
                  dispatch({ type: "CHOOSE_MODE", mode });
                }}
              />
            )}
            {state.screen === "survey" && state.survey && (
              <SurveyScreen
                survey={draft ?? state.survey}
                onChange={setDraft}
                source={source}
                onNext={() => dispatch({ type: "SURVEY_REVIEW", survey: draft ?? state.survey! })}
                onBack={() => dispatch({ type: "ENTER", account: state.account })}
              />
            )}
            {state.screen === "review" && state.survey && (
              <ReviewScreen
                survey={state.survey}
                onEdit={editSurvey}
                onStart={() => void start()}
                loading={starting}
                error={startError}
              />
            )}
            {state.screen === "selection" &&
              category &&
              request &&
              (complete ? (
                <section className="pc-loading" aria-busy={state.quotePending}>
                  <div className="pc-spinner" />
                  <h1>
                    {state.quotePending
                      ? "견적팀이 전체 구성을 확인하고 있습니다."
                      : "견적을 완성하지 못했습니다."}
                  </h1>
                  {state.error && (
                    <>
                      <p className="pc-error" role="alert">
                        {state.error}
                      </p>
                      <div className="pc-actions">
                        <button
                          className="pc-button pc-primary"
                          onClick={() => setQuoteRetry((value) => value + 1)}
                        >
                          다시 시도
                        </button>
                        <button
                          className="pc-button pc-secondary"
                          onClick={() => dispatch({ type: "VISIT_STEP", index: 0 })}
                        >
                          부품 다시 고르기
                        </button>
                        {state.editingCategory && (
                          <button
                            className="pc-button pc-secondary"
                            onClick={() => dispatch({ type: "CANCEL_EDIT" })}
                          >
                            이전 견적으로 돌아가기
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </section>
              ) : (
                <>
                  <CandidateScreen
                    key={`${category}-${state.conditions.color}-${retry}-${state.plan?.allocations[category]}`}
                    category={category}
                    result={state.candidates}
                    progress={state.progress}
                    pending={state.requestId !== null || (!state.candidates && !state.error)}
                    error={state.error}
                    budget={request.budget}
                    reason={state.plan?.reasons[category]}
                    onChoose={(candidate, allowUnknown) =>
                      dispatch({ type: "SELECT", candidate, allowUnknown })
                    }
                    onRetry={() => setRetry((value) => value + 1)}
                    onBudget={() => dispatch({ type: "OPEN_BUDGET" })}
                    onBack={back}
                    onEditSurvey={
                      state.editingCategory
                        ? () =>
                            dispatch({
                              type: "SET_CONDITIONS",
                              color: "",
                              note: state.conditions.note,
                            })
                        : editSurvey
                    }
                    canBudget={state.survey?.mode === "new"}
                    editing={Boolean(state.editingCategory)}
                  />
                  {state.conditions.note && (
                    <p className="pc-notice">변경 요청 메모: {state.conditions.note}</p>
                  )}
                </>
              ))}
            {state.screen === "budget" && request && (
              <BudgetScreen
                source={budgetSource}
                request={request}
                onApply={(proposal) => {
                  dispatch({ type: "BUDGET_PROPOSAL", proposal });
                  dispatch({ type: "ACCEPT_BUDGET" });
                }}
                onCancel={() => dispatch({ type: "REJECT_BUDGET" })}
              />
            )}
            {state.screen === "quote" && quote && state.survey && (
              <QuoteScreen
                key={quote.version}
                quotes={state.quotes}
                budget={state.survey.budget}
                pending={state.savePending}
                error={state.error}
                onEdit={(editCategory, color, note) =>
                  dispatch({ type: "EDIT_QUOTE", category: editCategory, color, note })
                }
                onConfirm={(acceptConditions) => void confirm(acceptConditions)}
                onSaved={() => {
                  if (state.receipt) dispatch({ type: "SHOW_SAVED" });
                }}
              />
            )}
            {state.screen === "saved" && state.receipt && state.survey && (
              <SavedScreen
                receipt={state.receipt}
                mode={state.survey.mode}
                onQuote={() => dispatch({ type: "VIEW_QUOTE" })}
                onPayment={() => dispatch({ type: "PAYMENT" })}
              />
            )}
            {state.screen === "payment" && state.receipt && (
              <PaymentScreen
                receipt={state.receipt}
                onQuote={() => dispatch({ type: "VIEW_QUOTE" })}
              />
            )}
          </div>
          {showSummary && (
            <SummaryPanel
              selected={state.selected}
              budget={state.survey!.budget}
              steps={state.plan!.steps}
              needsReview={state.needsReview}
              onVisit={
                state.screen === "selection" && !state.quotePending && !state.editingCategory
                  ? (index) => dispatch({ type: "VISIT_STEP", index })
                  : undefined
              }
            />
          )}
        </div>
      </div>
    </div>
  );
  return renderLayout(screen, ["type", "survey", "review"].includes(state.screen));
}
