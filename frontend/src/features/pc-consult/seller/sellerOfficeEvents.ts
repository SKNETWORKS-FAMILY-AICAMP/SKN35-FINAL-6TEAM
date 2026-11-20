/** Local demo receipts only: existing AgentEvent contract, no server publication or fake quote. */
import type { AgentEvent, WorkStatus } from "../../../api/client";
import { initialOfficeState, officeReducer, type OfficeState } from "../../office/officeState";
import type { SellerEvent } from "./sellerState";
import type { SellerState } from "./types";

export interface SellerOfficeTransition {
  office: OfficeState;
  events: AgentEvent[];
}

/** Keep the event journal even when a concurrent issue must not replace the active desk. */
export function sellerOfficeTransition(
  office: OfficeState,
  event: SellerEvent,
  before: SellerState,
  after: SellerState,
  occurredAt: string,
  lastSeq = office.lastSeq,
): SellerOfficeTransition {
  if (event.type === "RESET") return { office: initialOfficeState(), events: [] };
  const changed =
    before.office !== after.office ||
    before.feed !== after.feed ||
    before.uploadProgress !== after.uploadProgress ||
    before.alerts !== after.alerts;
  // A denial toast and an ignored stale callback cannot produce an accepted work receipt.
  if (!changed) return { office, events: [] };

  const context = after.office;
  let sessionId = context.issueId
    ? `seller-demo-issue:${context.issueId}`
    : `seller-demo-consultation:${context.consultationId}`;
  switch (event.type) {
    case "POLICY_SAVED":
      sessionId = `seller-demo-policy:${event.version}`;
      break;
    case "SAVE_POLICY":
      sessionId = "seller-demo-policy:legacy";
      break;
    case "UPLOAD_STARTED":
    case "UPLOAD_PROGRESS":
    case "UPLOAD_COMPLETED":
      sessionId = "seller-demo-document:upload";
      break;
    case "ABUSE_DETECTED":
    case "IGNORE_ALERT":
      sessionId = `seller-demo-alert:${event.id}`;
      break;
    case "SET_BLOCK":
      sessionId = `seller-demo-customer:${event.customerId}`;
      break;
    case "SALE_COMPLETED":
      sessionId = `seller-demo-sale:${event.id}`;
      break;
    case "APPROVE_EMPLOYEE":
    case "SET_EMPLOYEE_ROLE":
    case "SET_EMPLOYEE_STATUS":
      sessionId = `seller-demo-employee:${event.id}`;
      break;
    case "ASSIGN_ISSUE":
    case "COMPLETE_ISSUE":
    case "CLAIM_CLASSIFIED":
      sessionId = `seller-demo-issue:${event.id}`;
      break;
    case "PREVIEW_HANDOFF":
      sessionId = `seller-demo-preview:${event.input.id}`;
      break;
  }
  const preserveDesk =
    before.office === after.office &&
    (event.type === "ASSIGN_ISSUE" ||
      event.type === "COMPLETE_ISSUE" ||
      event.type === "CLAIM_CLASSIFIED" ||
      event.type === "PREVIEW_HANDOFF");
  const fresh =
    !preserveDesk &&
    (event.type === "CONSULT_STARTED" ||
      event.type === "CLAIM_RECEIVED" ||
      event.type === "PREVIEW_HANDOFF" ||
      office.version === 0 ||
      (event.type === "ASSIGN_ISSUE" && office.runEvent?.session_id !== sessionId));
  const version = fresh ? office.version + 1 : office.version;
  let next = office;
  const events: AgentEvent[] = [];
  function append(
    type: AgentEvent["type"],
    status: WorkStatus,
    message: string,
    team: AgentEvent["team"] = "consultation",
  ) {
    const receipt: AgentEvent = {
      seq: lastSeq + events.length + 1,
      session_id: sessionId,
      company_id: 0,
      run_id: `seller-demo-run:${sessionId}`,
      requirement_version: version,
      team,
      type,
      status,
      occurred_at: occurredAt,
      message: message.endsWith("(시연)") ? message : `${message} (시연)`,
      error: null,
      artifact: null,
      metrics: null,
    };
    events.push(receipt);
    next = officeReducer(next, receipt);
  }
  function completedReceipt(message: string, team: AgentEvent["team"] = "design") {
    // The synchronous mutation has succeeded. Its pair must not consume another task.
    append("task.started", "running", "수신한 업무 결과를 기록하고 있습니다.", team);
    append("task.completed", "completed", message, team);
  }
  switch (event.type) {
    case "CONSULT_STARTED":
      append("run.started", "running", "고객 상담을 시작했습니다.", null);
      append("task.started", "running", "고객의 요청을 확인하고 있습니다.");
      break;
    case "CONSULT_BUBBLE":
      append("task.progress", "running", event.customer ? "고객 요청을 받았습니다." : event.text);
      break;
    case "HANDOFF_STARTED":
      append("run.started", "running", "상담 내용을 인계하고 있습니다.", null);
      append("task.completed", "completed", "상담 접수를 마치고 인계 문서를 전달했습니다.");
      append("task.started", "running", "상담 요약과 인계 문서를 정리하고 있습니다.", "design");
      break;
    case "SUMMARY_READY":
      append("task.completed", "completed", "상담 요약을 고객 기록에 저장했습니다.", "design");
      append("run.needs_input", "needs_input", "담당자의 후속 확인을 기다립니다.", null);
      break;
    case "CLAIM_RECEIVED":
      append("run.started", "running", "고객의 클레임을 접수했습니다.", null);
      append("task.completed", "completed", "클레임 접수 문서를 분류 담당자에게 전달했습니다.");
      append(
        "task.started",
        "running",
        "클레임 유형과 담당 부서를 확인하고 있습니다.",
        "validation",
      );
      break;
    case "CLAIM_CLASSIFIED":
      append("task.completed", "completed", "클레임 분류를 마쳤습니다.", "validation");
      append("run.needs_input", "needs_input", "처리함에서 담당자를 배정해 주세요.", null);
      break;
    case "ASSIGN_ISSUE":
      if (
        !preserveDesk &&
        before.office.phase === "classifying" &&
        before.office.issueId === event.id &&
        next.teams.validation.activeTasks > 0
      ) {
        append(
          "task.failed",
          "cancelled",
          "담당자 배정으로 자동 분류를 중단했습니다.",
          "validation",
        );
      }
      append("run.started", "running", "담당자가 이슈를 처리하고 있습니다.", null);
      append(
        next.teams.consultation.activeTasks && !preserveDesk ? "task.progress" : "task.started",
        "running",
        `${event.assignee} 담당자가 이슈를 확인하고 있습니다.`,
      );
      break;
    case "COMPLETE_ISSUE":
      append("task.completed", "completed", "담당자가 이슈 처리를 완료했습니다.");
      append(
        "run.needs_input",
        "needs_input",
        "이슈를 처리했습니다. 다음 상담 요청을 기다립니다.",
        null,
      );
      break;
    case "PREVIEW_HANDOFF":
      append(
        "run.started",
        "running",
        event.input.dataOrigin === "browser-selection"
          ? "고객이 경고를 확인하고 선택한 제품의 정보 보강 요청을 접수했습니다."
          : "고객 미리보기의 인계 기록을 접수했습니다.",
        null,
      );
      append("task.completed", "completed", "고객 대화와 인계 사유를 전달했습니다.");
      append("task.started", "running", "인계 사유와 팀 검토 기록을 정리하고 있습니다.", "design");
      append(
        "task.completed",
        "completed",
        event.input.dataOrigin === "browser-selection"
          ? `상품 정보 보강 필요: ${event.input.reasons.join(" · ")}`
          : "인계 사유·대화·팀 검토 기록을 인계함에 보관했습니다.",
        "design",
      );
      append("run.needs_input", "needs_input", "인계함에서 담당자를 배정해 주세요.", null);
      break;
    case "POLICY_SAVED":
      completedReceipt(`저장된 기업 정책 v${event.version}을 설계팀이 반영했습니다.`);
      break;
    case "SAVE_POLICY":
      completedReceipt("배송비와 할인 정책의 시연 저장을 확인했습니다.");
      break;
    case "UPLOAD_STARTED":
      append("task.started", "running", "상담 자료를 등록하고 있습니다.", "design");
      break;
    case "UPLOAD_PROGRESS":
      append("task.progress", "running", `상담 자료 등록 ${after.uploadProgress}%`, "design");
      break;
    case "UPLOAD_COMPLETED": {
      const pendingUpload = next.teams.design.log.filter((entry) => entry.session_id === sessionId);
      const message = `${event.title} 문서가 상담 자료에 반영되었습니다.`;
      if (
        pendingUpload.some((entry) => entry.type === "task.started") &&
        pendingUpload.at(-1)?.type !== "task.completed"
      ) {
        append("task.completed", "completed", message, "design");
      } else {
        // Another consultation may have replaced the displayed version while upload was pending.
        completedReceipt(message);
      }
      break;
    }
    case "ABUSE_DETECTED":
      completedReceipt("*** 표현 감지 알림을 고객 관리에 기록했습니다.", "validation");
      break;
    case "IGNORE_ALERT":
      completedReceipt("담당자가 알림을 확인하고 무시 처리했습니다.", "validation");
      break;
    case "SALE_COMPLETED":
      // Sale receipt is not completion of a PC consultation or a new quote run.
      append("order.created", "completed", "판매 1건을 판매 현황에 반영했습니다.", null);
      break;
    case "SET_BLOCK":
      completedReceipt(
        event.blocked ? "관리자가 고객을 차단했습니다." : "관리자가 고객 차단을 해제했습니다.",
        "validation",
      );
      break;
    case "APPROVE_EMPLOYEE":
    case "SET_EMPLOYEE_ROLE":
    case "SET_EMPLOYEE_STATUS":
      completedReceipt(after.feed[0].text);
      break;
  }
  return { office: preserveDesk ? office : next, events };
}

/** Backward-compatible projection used by the existing OfficeScene contract tests. */
export function sellerOfficeEvent(
  office: OfficeState,
  event: SellerEvent,
  before: SellerState,
  after: SellerState,
  occurredAt: string,
): OfficeState {
  return sellerOfficeTransition(office, event, before, after, occurredAt).office;
}
