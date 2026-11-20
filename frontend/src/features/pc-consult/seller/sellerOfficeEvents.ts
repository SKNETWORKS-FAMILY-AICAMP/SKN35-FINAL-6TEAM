/**
 * 가상 판매자 시연에서 실제 수신한 이벤트를 기존 오피스 표시 형식으로 연결합니다.
 * 서버 이벤트를 발행하거나 저장하지 않습니다. 상담 요약은 설계·분석팀, 클레임 분류는
 * 검증팀의 시연 업무로 표시하며 PC 부품 설계·호환성 판정·견적 완료를 만들지 않습니다.
 */
import type { AgentEvent, WorkStatus } from "../../../api/client";
import { initialOfficeState, officeReducer, type OfficeState } from "../../office/officeState";
import type { SellerEvent } from "./sellerState";
import type { SellerState } from "./types";

export function sellerOfficeEvent(
  office: OfficeState,
  event: SellerEvent,
  before: SellerState,
  after: SellerState,
  occurredAt: string,
): OfficeState {
  if (event.type === "RESET") return initialOfficeState();
  // 권한 검사나 오래된 타이머 때문에 거절된 이벤트는 그림에도 반영하지 않습니다.
  if (before.office === after.office) return office;
  let next = office;
  const context = after.office;
  const sessionId = context.issueId
    ? `seller-demo-issue:${context.issueId}`
    : `seller-demo-consultation:${context.consultationId}`;
  const fresh =
    event.type === "CONSULT_STARTED" ||
    event.type === "CLAIM_RECEIVED" ||
    office.version === 0 ||
    (event.type === "ASSIGN_ISSUE" && office.runEvent?.session_id !== sessionId);
  const version = fresh ? office.version + 1 : office.version;
  function append(
    type: AgentEvent["type"],
    status: WorkStatus,
    message: string,
    team: AgentEvent["team"] = "consultation",
  ) {
    next = officeReducer(next, {
      seq: next.lastSeq + 1,
      session_id: sessionId,
      company_id: 0,
      run_id: `seller-demo-run:${sessionId}`,
      requirement_version: version,
      team,
      type,
      status,
      occurred_at: occurredAt,
      message: `${message} (시연)`,
      error: null,
      artifact: null,
      metrics: null,
    });
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
      append("run.started", "running", "담당자가 이슈를 처리하고 있습니다.", null);
      append(
        next.teams.consultation.activeTasks ? "task.progress" : "task.started",
        "running",
        `${event.assignee} 담당자가 이슈를 확인하고 있습니다.`,
      );
      break;
    case "COMPLETE_ISSUE":
      append("task.completed", "completed", "담당자가 이슈 처리를 완료했습니다.");
      // 이슈 처리 완료는 PC 설계·검증·견적의 전체 완료를 뜻하지 않습니다.
      append(
        "run.needs_input",
        "needs_input",
        "이슈를 처리했습니다. 다음 상담 요청을 기다립니다.",
        null,
      );
      break;
  }
  return next;
}
