import { useCallback, useEffect, useReducer, useRef } from "react";
import { DEMO_SCRIPT } from "./mockData";
import { reviewSelectionStore, useReviewSelections } from "../reviewSelectionStore";
import { reviewSelectionHandoff } from "./reviewSelectionHandoff";
import type { SellerEvent } from "./sellerState";
import type { DemoAction, PreviewHandoffInput, SellerMenu, SellerSession } from "./types";
import {
  initialSellerRuntime,
  selectSellerOperations,
  sellerRuntimeReducer,
  type SellerRuntime,
} from "./operations";

export interface DemoContext {
  prefix: string;
  customerId: string;
  consultationId: string;
  partId: string;
}

/** Cancellable event script; no completion state is emitted before its timer finishes. */
export function scheduleDemoScenario(
  action: Exclude<DemoAction, "reset">,
  context: DemoContext,
  emit: (event: SellerEvent) => void,
): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  let cancelled = false;
  const later = (delay: number, event: SellerEvent) => {
    timers.push(
      setTimeout(() => {
        if (!cancelled) emit(event);
      }, delay),
    );
  };
  const consultId = `${context.prefix}-chat`;
  const issueId = `${context.prefix}-issue`;
  function queue(kind: Exclude<DemoAction, "auto" | "reset">, offset: number, handoffId: string) {
    switch (kind) {
      case "consult":
        later(offset, { type: "CONSULT_STARTED", id: consultId, customerId: context.customerId });
        later(offset + 650, {
          type: "CONSULT_BUBBLE",
          id: consultId,
          text: DEMO_SCRIPT.bubbles[1],
          customer: false,
        });
        later(offset + 1200, {
          type: "CONSULT_BUBBLE",
          id: consultId,
          text: DEMO_SCRIPT.bubbles[2],
          customer: false,
        });
        break;
      case "handoff":
        later(offset, { type: "HANDOFF_STARTED", consultationId: handoffId });
        later(offset + 1500, { type: "SUMMARY_READY", consultationId: handoffId });
        break;
      case "claim":
        later(offset, { type: "CLAIM_RECEIVED", id: issueId, customerId: context.customerId });
        later(offset + 1500, { type: "CLAIM_CLASSIFIED", id: issueId });
        break;
      case "abuse":
        later(offset + 1000, {
          type: "ABUSE_DETECTED",
          id: `${context.prefix}-alert`,
          customerId: context.customerId,
        });
        break;
      case "sale":
        later(offset + 1200, {
          type: "SALE_COMPLETED",
          id: `${context.prefix}-quote`,
          partId: context.partId,
          customerId: context.customerId,
        });
        break;
    }
  }
  emit({ type: "SCENARIO_STARTED" });
  if (action === "auto") {
    queue("consult", 0, consultId);
    queue("handoff", 7000, consultId);
    queue("claim", 13000, consultId);
    queue("abuse", 20000, consultId);
    queue("sale", 25000, consultId);
  } else queue(action, 0, context.consultationId);
  later(action === "auto" ? 30000 : 1800, { type: "SCENARIO_FINISHED" });
  return () => {
    cancelled = true;
    timers.forEach(clearTimeout);
  };
}

export function useSellerDemo(session: SellerSession) {
  const reviewSelections = useReviewSelections(session.companyCode);
  const [{ state, office, events, performance }, dispatchEvent] = useReducer(
    (current: SellerRuntime, received: { event: SellerEvent; occurredAt: string }) =>
      sellerRuntimeReducer(current, received.event, session.role, received.occurredAt),
    session.companyCode,
    initialSellerRuntime,
  );
  const rawDispatch = useCallback((event: SellerEvent) => {
    dispatchEvent({ event, occurredAt: new Date().toISOString() });
  }, []);
  const generation = useRef(0);
  const sequence = useRef(0);
  const busy = useRef(false);
  const uploading = useRef(false);
  const cancelScenario = useRef<(() => void) | null>(null);
  const uploadTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const previousSession = useRef(`${session.companyCode}:${session.role}`);
  const cancelAll = useCallback(() => {
    generation.current += 1;
    cancelScenario.current?.();
    cancelScenario.current = null;
    uploadTimers.current.forEach(clearTimeout);
    uploadTimers.current = [];
    busy.current = false;
    uploading.current = false;
  }, []);
  useEffect(() => {
    const identity = `${session.companyCode}:${session.role}`;
    if (previousSession.current !== identity) {
      previousSession.current = identity;
      rawDispatch({ type: "RESET", companyCode: session.companyCode });
    }
    return cancelAll;
  }, [session.companyCode, session.role, cancelAll, rawDispatch]);
  useEffect(() => {
    reviewSelections.forEach((selection) =>
      rawDispatch({
        type: "PREVIEW_HANDOFF",
        input: reviewSelectionHandoff(selection),
      }),
    );
  }, [reviewSelections, session.role, rawDispatch]);
  useEffect(() => {
    if (!state.toast) return;
    const timer = setTimeout(
      () => rawDispatch({ type: "CLEAR_TOAST", toastId: state.toastId }),
      5000,
    );
    return () => clearTimeout(timer);
  }, [state.toast, state.toastId, rawDispatch]);

  const dispatch = useCallback(
    (event: SellerEvent) => {
      if (event.type === "RESET") {
        cancelAll();
        reviewSelectionStore.dispatch({ type: "RESET_COMPANY", companyCode: event.companyCode });
      }
      rawDispatch(event);
    },
    [cancelAll, rawDispatch],
  );

  function runDemo(action: DemoAction) {
    if (action === "reset") {
      cancelAll();
      reviewSelectionStore.dispatch({ type: "RESET_COMPANY", companyCode: session.companyCode });
      rawDispatch({ type: "RESET", companyCode: session.companyCode });
      rawDispatch({ type: "TOAST", message: "시연 데이터를 초기 상태로 되돌렸습니다." });
      return;
    }
    if (busy.current) {
      rawDispatch({ type: "TOAST", message: "실행 중인 시연이 끝난 뒤 다시 눌러 주세요." });
      return;
    }
    const customer = state.customers.find((entry) => !entry.blocked);
    const consultation =
      state.consultations.find(
        (entry) => entry.id === state.office.consultationId && !entry.summary,
      ) ?? state.consultations.find((entry) => !entry.summary);
    if (!customer || !state.parts.length) return;
    if (action === "handoff" && !consultation) {
      rawDispatch({
        type: "TOAST",
        message: "인계할 상담이 없습니다. 새 상담을 먼저 시작해 주세요.",
      });
      return;
    }
    busy.current = true;
    sequence.current += 1;
    const activeGeneration = generation.current;
    cancelScenario.current = scheduleDemoScenario(
      action,
      {
        prefix: `${session.companyCode}-event-${sequence.current}`,
        customerId: customer.id,
        consultationId: consultation?.id ?? "",
        partId: state.parts[sequence.current % state.parts.length].id,
      },
      (event) => {
        if (activeGeneration !== generation.current) return;
        if (event.type === "SCENARIO_FINISHED") busy.current = false;
        rawDispatch(event);
      },
    );
  }

  function uploadDocument(title: string, kind = "상품 안내") {
    if (session.role !== "admin") {
      rawDispatch({ type: "TOAST", message: "관리자만 문서를 등록할 수 있습니다." });
      return;
    }
    if (!title.trim()) {
      rawDispatch({ type: "TOAST", message: "등록할 파일을 선택해 주세요." });
      return;
    }
    if (uploading.current) {
      rawDispatch({ type: "TOAST", message: "진행 중인 문서 등록을 기다려 주세요." });
      return;
    }
    uploading.current = true;
    sequence.current += 1;
    const documentId = `${session.companyCode}-document-${sequence.current}`;
    const activeGeneration = generation.current;
    rawDispatch({ type: "UPLOAD_STARTED" });
    for (const [delay, progress] of [
      [500, 25],
      [1000, 50],
      [1500, 75],
    ] as const) {
      uploadTimers.current.push(
        setTimeout(() => {
          if (activeGeneration === generation.current)
            rawDispatch({ type: "UPLOAD_PROGRESS", progress });
        }, delay),
      );
    }
    uploadTimers.current.push(
      setTimeout(() => {
        if (activeGeneration !== generation.current) return;
        uploading.current = false;
        rawDispatch({ type: "UPLOAD_COMPLETED", id: documentId, title: title.trim(), kind });
      }, 2000),
    );
  }

  return {
    state,
    office,
    events,
    operations: selectSellerOperations(events),
    performance,
    reviewSelections,
    dispatch,
    runDemo,
    canManage: session.role === "admin",
    navigate: (menu: SellerMenu) => dispatch({ type: "NAVIGATE", menu }),
    uploadDocument,
    recordPolicySaved: (version: number) => dispatch({ type: "POLICY_SAVED", version }),
    receivePreviewHandoff: (input: PreviewHandoffInput) =>
      dispatch({ type: "PREVIEW_HANDOFF", input }),
    savePolicy: (shippingFee: number, discount: number) =>
      dispatch({ type: "SAVE_POLICY", shippingFee, discount }),
  };
}
