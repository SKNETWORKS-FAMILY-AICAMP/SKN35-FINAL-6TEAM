import type { Handoff } from "./officeCues";

/** 화면 연출 전용 상태입니다. 업무 이벤트나 officeReducer 상태를 만들거나 완료하지 않습니다. */
export interface DeliveryVisualState {
  scope: string;
  seenSeq: number;
  current: Handoff | null;
  pending: Handoff[];
}

type DeliveryAction =
  | { type: "observe"; scope: string; cue: Handoff | null; stopped: boolean; reduced: boolean }
  | { type: "arrived"; scope: string; seq: number };

export function initialDeliveryVisual(scope: string, cue: Handoff | null): DeliveryVisualState {
  return { scope, seenSeq: cue?.seq ?? 0, current: cue, pending: [] };
}

export function deliveryVisualReducer(
  state: DeliveryVisualState,
  action: DeliveryAction,
): DeliveryVisualState {
  if (action.type === "arrived") {
    // 이전 실행의 animationend가 새 실행의 캐릭터를 지우지 않게 합니다.
    if (state.scope !== action.scope || state.current?.seq !== action.seq) return state;
    return { ...state, current: state.pending[0] ?? null, pending: state.pending.slice(1) };
  }
  const suppress = action.stopped || action.reduced;
  if (state.scope !== action.scope) {
    const next = initialDeliveryVisual(action.scope, action.cue);
    return suppress ? { ...next, current: null } : next;
  }
  if (suppress) {
    const seenSeq = Math.max(state.seenSeq, action.cue?.seq ?? 0);
    if (!state.current && !state.pending.length && seenSeq === state.seenSeq) return state;
    return { ...state, seenSeq, current: null, pending: [] };
  }
  if (!action.cue || action.cue.seq <= state.seenSeq) return state;
  return {
    ...state,
    seenSeq: action.cue.seq,
    current: state.current ?? action.cue,
    // 장시간 정지한 동안의 시각 연출만 최근 12건으로 제한합니다. 실제 기록은 그대로입니다.
    pending: state.current ? [...state.pending, action.cue].slice(-12) : state.pending,
  };
}
