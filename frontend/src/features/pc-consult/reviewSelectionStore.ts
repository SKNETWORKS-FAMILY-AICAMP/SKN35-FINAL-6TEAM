import { useMemo, useSyncExternalStore } from "react";
import type { ConsultEvent, ConsultState } from "./state";
import type { Category } from "./types";

/** Browser actions only. No mock counts, storage, account details or server publication. */
export interface ReviewSelection {
  key: string;
  companyCode: string;
  consultationId: string;
  category: Category;
  sourceKey: string;
  productName: string;
  reasons: string[];
  selectedAt: string;
}

export type ReviewSelectionEvent =
  { type: "SELECTED"; selection: ReviewSelection } | { type: "RESET_COMPANY"; companyCode: string };

export function reviewSelectionReducer(
  state: readonly ReviewSelection[],
  event: ReviewSelectionEvent,
): readonly ReviewSelection[] {
  if (event.type === "RESET_COMPANY") {
    return state.some((entry) => entry.companyCode === event.companyCode)
      ? state.filter((entry) => entry.companyCode !== event.companyCode)
      : state;
  }
  if (state.some((entry) => entry.key === event.selection.key)) return state;
  return [...state, { ...event.selection, reasons: [...event.selection.reasons] }];
}

/** Read the accepted reducer result, never the untrusted card/event validation. */
export function acceptedReviewSelection(
  companyCode: string | undefined,
  event: ConsultEvent,
  previous: ConsultState,
  next: ConsultState,
  selectedAt: string,
): ReviewSelection | null {
  if (
    !companyCode ||
    event.type !== "SELECT" ||
    !event.allowUnknown ||
    previous === next ||
    previous.screen !== "selection" ||
    !next.consultationId
  )
    return null;
  const category = event.candidate.part.category;
  const selected = next.selected[category];
  const validation = next.validations[category];
  if (
    !selected ||
    selected.source_key !== event.candidate.part.source_key ||
    validation?.status !== "UNKNOWN"
  )
    return null;
  return {
    key: JSON.stringify([companyCode, next.consultationId, category, selected.source_key]),
    companyCode,
    consultationId: next.consultationId,
    category,
    sourceKey: selected.source_key,
    productName: selected.name,
    reasons: [
      ...new Set(
        validation.checks
          .filter((check) => check.status === "UNKNOWN")
          .map((check) => check.message),
      ),
    ],
    selectedAt,
  };
}

export function reviewSelectionHandoffId(companyCode: string, consultationId: string) {
  return `${companyCode}:${consultationId}`;
}

export function createReviewSelectionStore() {
  let snapshot: readonly ReviewSelection[] = [];
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispatch(event: ReviewSelectionEvent) {
      const next = reviewSelectionReducer(snapshot, event);
      if (next === snapshot) return;
      snapshot = next;
      listeners.forEach((listener) => listener());
    },
  };
}

// Module memory survives account/menu changes and is cleared by a browser refresh.
export const reviewSelectionStore = createReviewSelectionStore();

export function useReviewSelections(companyCode: string) {
  const snapshot = useSyncExternalStore(
    reviewSelectionStore.subscribe,
    reviewSelectionStore.getSnapshot,
    reviewSelectionStore.getSnapshot,
  );
  return useMemo(
    () => snapshot.filter((entry) => entry.companyCode === companyCode),
    [snapshot, companyCode],
  );
}
