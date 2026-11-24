import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { AgentEvent } from "../../api/client";
import { initialOfficeState, officeReducer } from "../office/officeState";
import { createOfficeEventAdapter } from "./officeEvents";
import type { ConsultEvent, ConsultState } from "./state";

interface QueueItem {
  event: AgentEvent;
  settled: Array<() => void>;
}

/** A cancellable display queue: work is already reported by the data source before enqueueing. */
export function createOfficeBridge(sessionId: string, intervalMs: number) {
  const adapter = createOfficeEventAdapter(sessionId);
  const listeners = new Set<() => void>();
  let office = initialOfficeState();
  let queue: QueueItem[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastDeliveredAt: number | null = null;
  let generation = 0;
  let enabled = true;
  const interval = Math.max(0, Number.isFinite(intervalMs) ? intervalMs : 700);

  const notify = () => listeners.forEach((listener) => listener());
  const apply = (event: AgentEvent) => {
    // Allocate sequence at delivery: cancelling pending records cannot leave sequence holes.
    office = officeReducer(office, { ...event, seq: office.lastSeq + 1 });
    lastDeliveredAt = Date.now();
    notify();
  };

  function schedule() {
    if (timer !== undefined || !queue.length || !enabled) return;
    const delay =
      lastDeliveredAt === null ? 0 : Math.max(0, lastDeliveredAt + interval - Date.now());
    if (delay === 0) {
      play();
      return;
    }
    const expected = generation;
    timer = setTimeout(() => {
      if (expected === generation) play();
    }, delay);
  }

  function play() {
    timer = undefined;
    const item = queue.shift();
    if (!item || !enabled) return;
    apply(item.event);
    item.settled.forEach((resolve) => resolve());
    schedule();
  }

  function clearQueue() {
    generation += 1;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    const dropped = queue;
    queue = [];
    for (const item of dropped) item.settled.forEach((resolve) => resolve());
  }

  function cancel() {
    const pending = queue.length > 0 || office.runStatus === "running";
    clearQueue();
    adapter.cancel();
    if (!pending) return;
    // Cancellation is immediate so outdated work stops visibly. The following normal
    // record waits one interval from this cancellation, including across empty queues.
    const base: AgentEvent = {
      company_id: 0,
      session_id: sessionId,
      requirement_version: office.version,
      run_id: office.runEvent?.run_id ?? null,
      occurred_at: new Date().toISOString(),
      seq: 0,
      team: null,
      type: "run.failed",
      status: "cancelled",
      message: "요청이 바뀌어 이전 작업 표시를 중단했습니다.",
    };
    for (const [team, state] of Object.entries(office.teams)) {
      for (let remaining = state.activeTasks; remaining > 0; remaining -= 1)
        apply({ ...base, team: team as AgentEvent["team"], type: "task.failed" });
    }
    apply(base);
  }

  return {
    getSnapshot: () => office,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    receive(event: ConsultEvent, previous: ConsultState, next: ConsultState): Promise<void> {
      if (!enabled || previous === next) return Promise.resolve();
      const interrupts =
        [
          "START",
          "EDIT_SURVEY",
          "ENTER",
          "CHOOSE_MODE",
          "RESTART",
          "SET_CONDITIONS",
          "VISIT_STEP",
          "EDIT_QUOTE",
          "OPEN_BUDGET",
          "ACCEPT_BUDGET",
          "REJECT_BUDGET",
          "CANCEL_EDIT",
        ].includes(event.type) ||
        (event.type === "REQUEST" && previous.requestId !== null) ||
        (event.type === "VIEW_QUOTE" && previous.requestId !== null);
      // User changes can overtake a completed source result that is still being shown.
      // Cancel it here before resolving the old receiver, so its caller's state guard wins.
      // Normal SELECT→REQUEST/QUOTE_REQUEST keeps its genuine handoff records in order.
      if (interrupts) cancel();
      const records = adapter.transition(event, previous, next);
      if (!records.length) return Promise.resolve();
      return new Promise<void>((resolve) => {
        records.forEach((record, index) => {
          const settled = index === records.length - 1 ? [resolve] : [];
          const last = queue.at(-1);
          // Sequential snapshot batches may report dozens of updates in one paint. Preserve
          // transitions and completions, while replacing only the same task's queued progress.
          if (
            record.type === "task.progress" &&
            last?.event.type === "task.progress" &&
            last.event.team === record.team &&
            last.event.run_id === record.run_id
          ) {
            queue[queue.length - 1] = { event: record, settled: [...last.settled, ...settled] };
          } else {
            queue.push({ event: record, settled });
          }
        });
        schedule();
      });
    },
    cancel,
    reset() {
      clearQueue();
      adapter.reset();
      office = initialOfficeState();
      lastDeliveredAt = null;
      notify();
    },
    activate() {
      enabled = true;
    },
    dispose() {
      enabled = false;
      cancel();
    },
  };
}

export function useOfficeBridge({
  sessionId,
  intervalMs,
}: {
  sessionId: string;
  intervalMs: number;
}) {
  const bridge = useMemo(() => createOfficeBridge(sessionId, intervalMs), [sessionId, intervalMs]);
  const office = useSyncExternalStore(bridge.subscribe, bridge.getSnapshot, bridge.getSnapshot);
  useEffect(() => {
    // StrictMode's setup→cleanup→setup must reactivate the same controller.
    bridge.activate();
    return () => bridge.dispose();
  }, [bridge]);
  return { office, receive: bridge.receive, cancel: bridge.cancel, reset: bridge.reset };
}
