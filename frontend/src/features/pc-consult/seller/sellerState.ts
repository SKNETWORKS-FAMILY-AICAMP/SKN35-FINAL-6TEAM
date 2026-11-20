import { DEMO_DATE, DEMO_SCRIPT, DEMO_TIME, initialSellerState } from "./mockData";
import type { SellerMenu, SellerRole, SellerState } from "./types";

export type SellerEvent =
  | { type: "NAVIGATE"; menu: SellerMenu }
  | { type: "TOAST"; message: string }
  | { type: "CLEAR_TOAST"; toastId: number }
  | { type: "RESET"; companyCode: string }
  | { type: "SCENARIO_STARTED" }
  | { type: "SCENARIO_FINISHED" }
  | { type: "CONSULT_STARTED"; id: string; customerId: string }
  | { type: "CONSULT_BUBBLE"; id: string; text: string; customer: boolean }
  | { type: "HANDOFF_STARTED"; consultationId: string }
  | { type: "SUMMARY_READY"; consultationId: string }
  | { type: "CLAIM_RECEIVED"; id: string; customerId: string }
  | { type: "CLAIM_CLASSIFIED"; id: string }
  | { type: "ABUSE_DETECTED"; id: string; customerId: string }
  | { type: "SALE_COMPLETED"; id: string; partId: string; customerId: string }
  | { type: "SET_BLOCK"; customerId: string; blocked: boolean; reason?: string }
  | { type: "REQUEST_REVIEW"; customerId: string }
  | { type: "IGNORE_ALERT"; id: string }
  | { type: "ASSIGN_ISSUE"; id: string; assignee: string }
  | { type: "COMPLETE_ISSUE"; id: string }
  | { type: "APPROVE_EMPLOYEE"; id: string }
  | { type: "SET_EMPLOYEE_ROLE"; id: string; role: SellerRole }
  | { type: "SET_EMPLOYEE_STATUS"; id: string; status: "active" | "inactive" }
  | { type: "UPLOAD_STARTED" }
  | { type: "UPLOAD_PROGRESS"; progress: number }
  | { type: "UPLOAD_COMPLETED"; id: string; title: string; kind: string }
  | { type: "SAVE_POLICY"; shippingFee: number; discount: number };

const protectedMenus = new Set<SellerMenu>(["sales", "documents", "employees"]);
const protectedEvents = new Set<SellerEvent["type"]>([
  "SET_BLOCK",
  "APPROVE_EMPLOYEE",
  "SET_EMPLOYEE_ROLE",
  "SET_EMPLOYEE_STATUS",
  "UPLOAD_STARTED",
  "UPLOAD_PROGRESS",
  "UPLOAD_COMPLETED",
  "SAVE_POLICY",
]);

function toast(state: SellerState, message: string): SellerState {
  return { ...state, toast: message, toastId: state.toastId + 1 };
}

function activity(
  state: SellerState,
  changes: Partial<SellerState>,
  text: string,
  menus: SellerMenu[],
): SellerState {
  const next = { ...state, ...changes };
  return {
    ...next,
    feed: [
      { id: (state.feed[0]?.id ?? 0) + 1, text, time: DEMO_TIME, menu: menus[0] },
      ...state.feed,
    ].slice(0, 80),
    unread: [...new Set([...state.unread, ...menus.filter((menu) => menu !== next.menu)])],
  };
}

export const pendingIssueCount = (state: SellerState) =>
  state.issues.filter((issue) => issue.stage !== "done").length;
export const activeAbuseCount = (state: SellerState) =>
  state.alerts.filter(
    (alert) =>
      !alert.ignored &&
      !state.customers.find((customer) => customer.id === alert.customerId)?.blocked,
  ).length;

/** UI permissions are checked here as well as in controls; this is not server authentication. */
export function sellerReducer(
  state: SellerState,
  event: SellerEvent,
  role: SellerRole = "agent",
): SellerState {
  const preserveConsultationOffice =
    state.scenarioRunning && (state.office.phase === "talking" || state.office.phase === "handoff");
  if (role !== "admin" && protectedEvents.has(event.type)) {
    return toast(
      state,
      event.type === "SET_BLOCK"
        ? "관리자에게 검토를 요청했습니다. 차단 상태는 변경되지 않습니다. (시연)"
        : "관리자만 사용할 수 있습니다.",
    );
  }
  switch (event.type) {
    case "NAVIGATE":
      if (role !== "admin" && protectedMenus.has(event.menu))
        return toast(state, "관리자만 사용할 수 있습니다.");
      return {
        ...state,
        menu: event.menu,
        unread: state.unread.filter((menu) => menu !== event.menu),
      };
    case "TOAST":
      return toast(state, event.message);
    case "CLEAR_TOAST":
      return event.toastId === state.toastId ? { ...state, toast: "" } : state;
    case "RESET":
      return initialSellerState(event.companyCode);
    case "SCENARIO_STARTED":
      return { ...state, scenarioRunning: true };
    case "SCENARIO_FINISHED":
      return { ...state, scenarioRunning: false };
    case "CONSULT_STARTED": {
      const customer = state.customers.find(
        (entry) => entry.id === event.customerId && !entry.blocked,
      );
      if (!customer || state.consultations.some((entry) => entry.id === event.id)) return state;
      return activity(
        state,
        {
          customers: state.customers.map((entry) =>
            entry.id === customer.id
              ? { ...entry, lastConsulted: `${DEMO_DATE} ${DEMO_TIME}` }
              : entry,
          ),
          consultations: [
            {
              id: event.id,
              customerId: customer.id,
              date: `${DEMO_DATE} ${DEMO_TIME}`,
              lines: [{ speaker: "고객", text: DEMO_SCRIPT.bubbles[0] }],
              summary: null,
            },
            ...state.consultations,
          ],
          todayConsultations: state.todayConsultations + 1,
          activeConsultations: state.activeConsultations + 1,
          office: {
            phase: "talking",
            consultationId: event.id,
            customerId: customer.id,
            bubble: DEMO_SCRIPT.bubbles[0],
            issueId: null,
            log: [...state.office.log, "상담을 시작했습니다."].slice(-12),
          },
        },
        `${customer.name} · 상담을 시작했습니다.`,
        ["customers", "office", "home"],
      );
    }
    case "CONSULT_BUBBLE":
      if (state.office.consultationId !== event.id || state.office.phase !== "talking")
        return state;
      return {
        ...state,
        office: { ...state.office, bubble: event.text },
        consultations: state.consultations.map((entry) =>
          entry.id === event.id
            ? {
                ...entry,
                lines: [
                  ...entry.lines,
                  { speaker: event.customer ? "고객" : "상담 에이전트", text: event.text },
                ],
              }
            : entry,
        ),
      };
    case "HANDOFF_STARTED": {
      const consultation = state.consultations.find(
        (entry) => entry.id === event.consultationId && !entry.summary,
      );
      if (!consultation)
        return toast(state, "인계할 진행 중 상담이 없습니다. 먼저 새 상담을 시작해 주세요.");
      return activity(
        state,
        {
          office: {
            ...state.office,
            phase: "handoff",
            consultationId: consultation.id,
            customerId: consultation.customerId,
            bubble: DEMO_SCRIPT.handoff,
            issueId: null,
            log: [...state.office.log, "상담 문서를 인계하고 있습니다."].slice(-12),
          },
        },
        "상담 문서를 인계 에이전트에게 전달하고 있습니다.",
        ["office", "customers", "home"],
      );
    }
    case "SUMMARY_READY": {
      if (state.office.consultationId !== event.consultationId || state.office.phase !== "handoff")
        return state;
      if (!state.consultations.some((entry) => entry.id === event.consultationId && !entry.summary))
        return state;
      return activity(
        state,
        {
          consultations: state.consultations.map((entry) =>
            entry.id === event.consultationId
              ? { ...entry, summary: { ...DEMO_SCRIPT.summary } }
              : entry,
          ),
          activeConsultations: Math.max(0, state.activeConsultations - 1),
          waitingConsultations:
            state.activeConsultations === 0
              ? Math.max(0, state.waitingConsultations - 1)
              : state.waitingConsultations,
          completedConsultations: state.completedConsultations + 1,
          office: {
            ...state.office,
            phase: "summary",
            bubble: "상담 요약이 고객 기록에 저장되었습니다. (시연)",
            log: [...state.office.log, "고객 기록에 상담 요약을 저장했습니다."].slice(-12),
          },
        },
        "상담 인계가 완료되어 고객 기록에 요약을 저장했습니다. (시연)",
        ["customers", "office", "home"],
      );
    }
    case "CLAIM_RECEIVED":
      if (
        !state.customers.some((entry) => entry.id === event.customerId) ||
        state.issues.some((entry) => entry.id === event.id)
      )
        return state;
      return activity(
        state,
        {
          issues: [
            {
              id: event.id,
              customerId: event.customerId,
              kind: "클레임",
              stage: "received",
              assignee: "미배정",
              ...DEMO_SCRIPT.claim,
            },
            ...state.issues,
          ],
          office: {
            ...state.office,
            phase: "classifying",
            customerId: event.customerId,
            issueId: event.id,
            bubble: "인계 문서를 헬퍼에게 보내 요청을 분류하고 있습니다.",
            log: [...state.office.log, "클레임을 접수했습니다."].slice(-12),
          },
        },
        "새 클레임을 접수했습니다. 헬퍼가 분류하고 있습니다.",
        ["issues", "office", "home"],
      );
    case "CLAIM_CLASSIFIED":
      if (!state.issues.some((entry) => entry.id === event.id && entry.stage === "received"))
        return state;
      return activity(
        state,
        {
          issues: state.issues.map((entry) =>
            entry.id === event.id ? { ...entry, stage: "classified" } : entry,
          ),
          office:
            state.office.issueId === event.id
              ? {
                  ...state.office,
                  phase: "classified",
                  bubble: "배송 확인 요청으로 분류했습니다. 담당자 배정을 기다립니다.",
                  log: [...state.office.log, "헬퍼가 클레임을 분류했습니다."].slice(-12),
                }
              : state.office,
        },
        "헬퍼가 클레임 분류를 완료했습니다.",
        ["issues", "office", "home"],
      );
    case "ABUSE_DETECTED":
      if (
        !state.customers.some((entry) => entry.id === event.customerId) ||
        state.alerts.some((entry) => entry.id === event.id)
      )
        return state;
      return toast(
        activity(
          state,
          {
            alerts: [
              {
                id: event.id,
                customerId: event.customerId,
                text: DEMO_SCRIPT.abuse,
                time: DEMO_TIME,
                ignored: false,
              },
              ...state.alerts,
            ],
          },
          "상담 중 *** 표현이 감지되었습니다. 확인해 주세요.",
          ["customers", "home"],
        ),
        "*** 표현 감지 · 고객 관리에서 확인해 주세요. (시연)",
      );
    case "SALE_COMPLETED": {
      const part = state.parts.find((entry) => entry.id === event.partId);
      if (
        !part ||
        !state.customers.some((entry) => entry.id === event.customerId) ||
        state.quotes.some((entry) => entry.id === event.id)
      )
        return state;
      return activity(
        state,
        {
          parts: state.parts.map((entry) =>
            entry.id === part.id ? { ...entry, sales: entry.sales + 1 } : entry,
          ),
          todaySales: state.todaySales + 1,
          quotes: [
            {
              id: event.id,
              customerId: event.customerId,
              date: `${DEMO_DATE} ${DEMO_TIME}`,
              total: part.price,
              items: [{ name: part.name, price: part.price, quantity: 1 }],
            },
            ...state.quotes,
          ],
        },
        `${part.name} 판매 1건이 반영되었습니다. (시연)`,
        ["sales", "customers", "home"],
      );
    }
    case "SET_BLOCK": {
      const customer = state.customers.find((entry) => entry.id === event.customerId);
      if (!customer || customer.blocked === event.blocked) return state;
      if (event.blocked && !event.reason?.trim()) return toast(state, "차단 사유를 입력해 주세요.");
      return toast(
        activity(
          state,
          {
            customers: state.customers.map((entry) =>
              entry.id === event.customerId
                ? {
                    ...entry,
                    blocked: event.blocked,
                    blockReason: event.blocked ? event.reason!.trim() : "",
                    blockedBy: event.blocked ? "가상관리" : "",
                    blockedAt: event.blocked ? `${DEMO_DATE} ${DEMO_TIME}` : "",
                  }
                : entry,
            ),
          },
          `${customer.name} · ${event.blocked ? "차단" : "차단 해제"}했습니다. (시연)`,
          ["customers", "home"],
        ),
        event.blocked ? "고객을 차단했습니다. (시연)" : "차단을 해제했습니다. (시연)",
      );
    }
    case "REQUEST_REVIEW":
      return state.customers.some((entry) => entry.id === event.customerId)
        ? toast(state, "관리자에게 요청했습니다. (시연)")
        : state;
    case "IGNORE_ALERT":
      if (!state.alerts.some((entry) => entry.id === event.id)) return state;
      return toast(
        {
          ...state,
          alerts: state.alerts.map((entry) =>
            entry.id === event.id ? { ...entry, ignored: true } : entry,
          ),
        },
        "알림을 무시했습니다. 고객은 차단되지 않습니다.",
      );
    case "ASSIGN_ISSUE":
      if (
        !state.issues.some((entry) => entry.id === event.id && entry.stage !== "done") ||
        !state.employees.some((entry) => entry.name === event.assignee && entry.status === "active")
      )
        return toast(state, "활성 담당자를 선택해 주세요.");
      return activity(
        state,
        {
          issues: state.issues.map((entry) =>
            entry.id === event.id
              ? { ...entry, assignee: event.assignee, stage: "working" }
              : entry,
          ),
          // Issue actions remain available without interrupting pending consultation events.
          office: preserveConsultationOffice
            ? state.office
            : {
                ...state.office,
                phase: "working",
                issueId: event.id,
                bubble: `${event.assignee} 담당자가 이슈를 처리하고 있습니다.`,
              },
        },
        `${event.assignee} 담당자에게 이슈를 배정했습니다.`,
        ["issues", "office", "home"],
      );
    case "COMPLETE_ISSUE":
      if (
        !state.issues.some(
          (entry) =>
            entry.id === event.id && entry.stage === "working" && entry.assignee !== "미배정",
        )
      )
        return toast(state, "담당자를 배정한 뒤 처리 완료해 주세요.");
      return activity(
        state,
        {
          issues: state.issues.map((entry) =>
            entry.id === event.id ? { ...entry, stage: "done" } : entry,
          ),
          office: preserveConsultationOffice
            ? state.office
            : {
                ...state.office,
                phase: "done",
                issueId: event.id,
                bubble: DEMO_SCRIPT.completed,
              },
        },
        "담당자가 이슈 처리를 완료했습니다.",
        ["issues", "office", "home"],
      );
    case "APPROVE_EMPLOYEE":
      if (!state.employees.some((entry) => entry.id === event.id && entry.status === "pending"))
        return state;
      return toast(
        activity(
          state,
          {
            employees: state.employees.map((entry) =>
              entry.id === event.id ? { ...entry, status: "active" } : entry,
            ),
          },
          "직원 가입 신청을 승인했습니다. (시연)",
          ["employees"],
        ),
        "직원 가입을 승인했습니다. (시연)",
      );
    case "SET_EMPLOYEE_ROLE":
    case "SET_EMPLOYEE_STATUS": {
      const employee = state.employees.find((entry) => entry.id === event.id);
      if (!employee) return state;
      const removesAdmin =
        employee.role === "admin" &&
        employee.status === "active" &&
        (event.type === "SET_EMPLOYEE_ROLE" ? event.role !== "admin" : event.status !== "active");
      if (
        removesAdmin &&
        state.employees.filter((entry) => entry.role === "admin" && entry.status === "active")
          .length === 1
      )
        return toast(state, "활성 관리자는 최소 한 명 필요합니다.");
      return toast(
        activity(
          state,
          {
            employees: state.employees.map((entry) =>
              entry.id === event.id
                ? event.type === "SET_EMPLOYEE_ROLE"
                  ? { ...entry, role: event.role }
                  : { ...entry, status: event.status }
                : entry,
            ),
          },
          "직원 권한 또는 활성 상태를 변경했습니다. (시연)",
          ["employees"],
        ),
        "직원 설정을 변경했습니다. (시연)",
      );
    }
    case "UPLOAD_STARTED":
      return state.uploadProgress === null ? { ...state, uploadProgress: 0 } : state;
    case "UPLOAD_PROGRESS":
      return state.uploadProgress === null
        ? state
        : {
            ...state,
            uploadProgress: Math.max(state.uploadProgress, Math.min(99, event.progress)),
          };
    case "UPLOAD_COMPLETED":
      if (
        state.uploadProgress === null ||
        !event.title.trim() ||
        state.documents.some((entry) => entry.id === event.id)
      )
        return state;
      return toast(
        activity(
          state,
          {
            uploadProgress: null,
            documents: [
              {
                id: event.id,
                title: event.title,
                kind: event.kind,
                updatedAt: `${DEMO_DATE} ${DEMO_TIME}`,
                reflected: true,
              },
              ...state.documents,
            ],
          },
          "시연 문서가 상담 자료에 반영되었습니다.",
          ["documents", "home"],
        ),
        "문서가 상담에 반영되었습니다. (파일 내용은 저장하지 않는 시연입니다.)",
      );
    case "SAVE_POLICY":
      if (
        !Number.isFinite(event.shippingFee) ||
        event.shippingFee < 0 ||
        !Number.isFinite(event.discount) ||
        event.discount < 0 ||
        event.discount > 100
      )
        return toast(state, "배송비는 0원 이상, 할인율은 0~100%로 입력해 주세요.");
      return toast(
        activity(
          state,
          { shippingFee: Math.round(event.shippingFee), discount: event.discount },
          "배송비와 할인 정책을 저장했습니다. (시연)",
          ["documents", "home"],
        ),
        "견적에 반영되었습니다. (기업 정책 시연 · 실제 PC 견적에는 미반영)",
      );
  }
}
