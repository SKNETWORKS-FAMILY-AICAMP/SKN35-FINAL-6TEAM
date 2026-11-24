import type { AgentEvent, WorkStatus } from "../../../api/client";
import { initialOfficeState, officeReducer, type OfficeState } from "../../office/officeState";
import { B2B_METRICS, initialSellerEvents, initialSellerState } from "./mockData";
import { sellerOfficeTransition } from "./sellerOfficeEvents";
import { sellerReducer, type SellerEvent } from "./sellerState";
import type { Activity, SellerIssue, SellerRole, SellerState } from "./types";

export interface SellerOperation extends Activity {
  seq: number;
  team: AgentEvent["team"];
  status: WorkStatus;
  type: AgentEvent["type"];
  occurredAt: string;
}
export interface SellerPerformance {
  label: string;
  consultations: number;
  completed: number;
  automaticallyResolved: number;
  handedOff: number;
  quoted: number;
  averageResponseSeconds: number;
}
export interface SellerRuntime {
  state: SellerState;
  office: OfficeState;
  events: AgentEvent[];
  performance: SellerPerformance;
}

/** Missing timestamps stay unknown. Stable source order is retained for unknown-time entries. */
export function issueTimeline(issue: SellerIssue) {
  return [
    ...(issue.lines ?? []).map((line) => ({
      speaker: line.speaker,
      text: line.text,
      occurredAt: line.occurredAt ?? "",
      kind: "대화",
    })),
    ...(issue.teamNotes ?? []).map((note) => ({
      speaker: note.team,
      text: note.message,
      occurredAt: note.occurredAt,
      kind: "팀 기록",
    })),
  ]
    .map((entry, index) => ({ ...entry, index, timestamp: Date.parse(entry.occurredAt) }))
    .sort((a, b) => {
      const first = Number.isNaN(a.timestamp) ? Infinity : a.timestamp;
      const second = Number.isNaN(b.timestamp) ? Infinity : b.timestamp;
      return first === second ? a.index - b.index : first - second;
    });
}

export function initialSellerRuntime(companyCode: string): SellerRuntime {
  const state = initialSellerState(companyCode);
  const events = initialSellerEvents(companyCode, state);
  return {
    state,
    events,
    office: events.reduce(officeReducer, initialOfficeState()),
    performance: { ...B2B_METRICS },
  };
}

/** One accepted business transition supplies both the receipt journal and the office drawing. */
export function sellerRuntimeReducer(
  current: SellerRuntime,
  event: SellerEvent,
  role: SellerRole,
  occurredAt: string,
): SellerRuntime {
  if (event.type === "RESET") return initialSellerRuntime(event.companyCode);
  const state = sellerReducer(current.state, event, role);
  const receipt = sellerOfficeTransition(
    current.office,
    event,
    current.state,
    state,
    occurredAt,
    current.events.at(-1)?.seq ?? current.office.lastSeq,
  );
  let performance = current.performance;
  if (
    event.type === "CONSULT_STARTED" &&
    state.todayConsultations > current.state.todayConsultations
  ) {
    performance = { ...performance, consultations: performance.consultations + 1 };
  }
  if (
    event.type === "SUMMARY_READY" &&
    state.completedConsultations > current.state.completedConsultations
  ) {
    performance = {
      ...performance,
      completed: performance.completed + 1,
      handedOff: performance.handedOff + 1,
    };
  }
  if (
    event.type === "PREVIEW_HANDOFF" &&
    !event.input.dataOrigin &&
    state.issues !== current.state.issues
  ) {
    performance = {
      ...performance,
      consultations: performance.consultations + 1,
      completed: performance.completed + 1,
      handedOff: performance.handedOff + 1,
    };
  }
  // Team tasks are not automatically resolved consultations. No task counter changes that metric.
  return {
    state,
    office: receipt.office,
    events: receipt.events.length
      ? [...current.events, ...receipt.events].slice(-200)
      : current.events,
    performance,
  };
}

/** Activity labels are projected from actual AgentEvent receipts, not a second scripted feed. */
export function selectSellerOperations(events: AgentEvent[], limit = 12): SellerOperation[] {
  return events
    .filter((event) => event.type !== "task.progress" && event.type !== "run.started")
    .slice(-limit)
    .reverse()
    .map((event) => {
      const family = event.session_id.split(":", 1)[0];
      const menu: Activity["menu"] =
        family === "seller-demo-policy" || family === "seller-demo-document"
          ? "catalog"
          : family === "seller-demo-issue" || family === "seller-demo-preview"
            ? "issues"
            : family === "seller-demo-sale"
              ? "sales"
              : family === "seller-demo-employee"
                ? "teams"
                : "customers";
      const date = new Date(event.occurred_at);
      return {
        id: event.seq,
        seq: event.seq,
        team: event.team,
        status: event.status,
        type: event.type,
        occurredAt: event.occurred_at,
        text: event.message,
        time: Number.isNaN(date.getTime())
          ? "시각 확인 필요"
          : date.toLocaleTimeString("ko-KR", {
              timeZone: "Asia/Seoul",
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            }),
        menu,
      };
    });
}
