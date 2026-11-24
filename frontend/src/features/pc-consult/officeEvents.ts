import type { AgentEvent, Team, WorkStatus } from "../../api/client";
import { currentCategory, currentQuote, type ConsultEvent, type ConsultState } from "./state";
import { CATEGORY_LABELS, won } from "./types";

/** Translates completed local work into the existing event contract, without backend writes. */
export function createOfficeEventAdapter(sessionId: string) {
  let seq = 0;
  let version = 0;
  let runNumber = 0;
  let runId: string | null = null;
  const active = new Set<Team>();

  function reset() {
    seq = 0;
    version = 0;
    runNumber = 0;
    runId = null;
    active.clear();
  }

  function transition(event: ConsultEvent, previous: ConsultState, next: ConsultState) {
    const events: AgentEvent[] = [];
    // The consultation reducer owns validation, including stale-request and save guards.
    if (previous === next) return events;
    const category = currentCategory(previous) ?? currentCategory(next);
    const label = category ? CATEGORY_LABELS[category] : "부품";

    function emit(
      type: AgentEvent["type"],
      team: Team | null,
      status: WorkStatus,
      message: string,
      extra: Partial<Pick<AgentEvent, "artifact" | "metrics" | "error">> = {},
    ) {
      events.push({
        type,
        team,
        status,
        message,
        company_id: 0, // Local snapshot session, never a persisted company identifier.
        session_id: sessionId,
        requirement_version: version,
        run_id: runId,
        seq: ++seq,
        occurred_at: new Date().toISOString(),
        ...extra,
      });
    }

    function start(team: Team, message: string) {
      if (active.has(team)) return;
      active.add(team);
      emit("task.started", team, "running", message);
    }

    function finish(team: Team, message: string, extra?: Partial<Pick<AgentEvent, "artifact">>) {
      active.delete(team);
      emit("task.completed", team, "completed", message, extra);
    }

    function stop(message: string, status: "cancelled" | "failed" = "cancelled") {
      for (const team of active) emit("task.failed", team, status, message);
      active.clear();
    }

    function run(message: string) {
      runId = `${sessionId}/work-${++runNumber}`;
      emit("run.started", null, "running", message);
    }

    function revision(message: string) {
      stop("이전 조건의 작업을 중단했습니다.");
      version += 1;
      runId = null;
      emit("requirements.updated", "consultation", "completed", message, {
        artifact: { kind: "requirements", id: `${sessionId}/requirements-${version}` },
      });
    }

    function needsInput(message: string, team: Team | null = "design") {
      if (team) emit("task.needs_input", team, "needs_input", message);
      emit("run.needs_input", null, "needs_input", message);
    }

    function beginValidation(total: number) {
      if (active.has("validation")) return;
      if (active.has("design")) finish("design", `${label} 검색 조건에 맞는 후보를 찾았습니다.`);
      // snapshotSource checks candidates sequentially; this is ONE aggregate task, not N workers.
      start("validation", `${label} 후보의 호환성을 확인하고 있습니다. (0/${total}) · 간이 판단`);
    }

    switch (event.type) {
      case "START":
        revision(
          `${event.survey.mode === "new" ? "신규 조립" : "부품 교체"} 설문을 확인했습니다. 예산 ${won(event.survey.budget)}, ${event.plan.steps.length}개 부품을 상담합니다. · 간이 판단`,
        );
        if (!event.plan.steps.length)
          needsInput(next.error ?? "설문을 다시 확인해 주세요.", "consultation");
        break;
      case "EDIT_SURVEY":
        stop("설문을 수정하기 위해 이전 작업을 멈췄습니다.");
        needsInput("설문을 고친 뒤 상담을 다시 시작해 주세요.", "consultation");
        break;
      case "ENTER":
      case "CHOOSE_MODE":
      case "RESTART":
        if (version > 0) {
          stop("이전 상담 표시를 멈췄습니다.");
          needsInput("새 상담의 유형과 설문을 입력해 주세요.", "consultation");
        }
        break;
      case "REQUEST":
        stop("새 조회를 시작해 이전 조회를 중단했습니다.");
        run(`${label} 후보를 조회합니다.`);
        start("design", `${label} 후보를 찾고 있습니다. · 간이 판단`);
        break;
      case "PROGRESS": {
        const { phase, completed, total } = event.progress;
        if (phase === "validation") {
          beginValidation(total);
          emit(
            "task.progress",
            "validation",
            "running",
            `${label} 호환성을 확인하고 있습니다. (${completed}/${total}) · 간이 판단`,
            {
              metrics: { completed, total },
            },
          );
        } else if (phase === "loading" || phase === "design") {
          emit(
            "task.progress",
            "design",
            "running",
            phase === "loading"
              ? "부품 스냅샷을 불러오고 있습니다."
              : `${label}의 예산과 사양 조건을 확인하고 있습니다. · 간이 판단`,
          );
        }
        // A ready progress callback is not a result. CANDIDATES alone finishes the tasks.
        break;
      }
      case "CANDIDATES": {
        const { passed, needsReview, rejectedCount } = event.result;
        beginValidation(passed.length + needsReview.length + rejectedCount);
        finish(
          "validation",
          `${label} 검증을 마쳤습니다. 통과·조건부 ${passed.length}개, 확인 필요 ${needsReview.length}개, 제외 ${rejectedCount}개입니다. · 간이 판단`,
        );
        start("design", `${label} 검증 결과를 정리하고 있습니다.`);
        finish("design", `${label} 후보 정리를 마쳤습니다. ${event.result.sortLabel}`, {
          artifact: { kind: "recommendation", id: `${runId}/candidates` },
        });
        needsInput(
          passed.length
            ? `${label} 후보와 검증 조건을 확인하고 선택해 주세요.`
            : needsReview.length
              ? "통과한 후보가 없습니다. 확인이 더 필요한 후보의 경고를 확인하거나 조건을 바꿔 주세요."
              : "후보가 없습니다. 예산이나 조건을 바꿔 주세요.",
        );
        break;
      }
      case "SELECT":
        if (next.selected[category!]) {
          start("design", `${label} 선택을 반영하고 있습니다.`);
          finish(
            "design",
            `${event.candidate.part.name}을 선택하셨습니다.${next.needsReview.length ? ` 뒤의 ${next.needsReview.length}개 부품은 다시 확인해야 합니다.` : ""}`,
          );
        }
        break;
      case "QUOTE_REQUEST":
        stop("새 견적 작업을 시작했습니다.");
        run("선택한 전체 구성과 견적을 확인하고 있습니다.");
        start("validation", "전체 구성의 호환성을 다시 확인하고 있습니다. · 간이 판단");
        break;
      case "QUOTE_READY":
        if (next.error || currentQuote(next)?.version !== event.quote.version) {
          stop(next.error ?? "현재 선택과 견적이 다릅니다.", "failed");
          emit("run.failed", null, "failed", next.error ?? "견적을 다시 만들어 주세요.", {
            error: {
              code: "QUOTE_MISMATCH",
              message: next.error ?? "견적 불일치",
              retryable: true,
            },
          });
          break;
        }
        finish(
          "validation",
          `전체 구성 확인을 마쳤습니다.${event.quote.validation.status === "UNKNOWN" ? " 확인 불가 항목을 견적에서 확인해 주세요." : event.quote.validation.status === "CONDITIONAL" ? " 조건부 항목을 견적에서 확인해 주세요." : ""} · 간이 판단`,
        );
        start("quotation", "검증 결과와 부품별 테스트 가격을 견적으로 정리하고 있습니다.");
        finish(
          "quotation",
          `견적 v${event.quote.version} · ${event.quote.items.length}개 부품 · ${won(event.quote.total_amount)} (테스트 가격)`,
          {
            artifact: { kind: "quotation", id: `${next.consultationId}/v${event.quote.version}` },
          },
        );
        // Keep quotation's last event completed so the existing office shows its actual amount.
        needsInput(
          `견적 v${event.quote.version}을 확인하고 승인해 주세요. 아직 저장하지 않았습니다.`,
          null,
        );
        break;
      case "CONFIRM_REQUEST":
        run("승인한 견적을 저장하고 있습니다.");
        start("quotation", `견적 v${currentQuote(previous)?.version ?? ""}을 저장하고 있습니다.`);
        break;
      case "CONFIRMED":
        finish(
          "quotation",
          `견적 v${event.receipt.quote.version} · ${won(event.receipt.quote.total_amount)} (테스트 가격) · ${event.receipt.storage === "memory" ? "시연 저장 (DB에 기록 안 됨)" : "저장 완료"}`,
          {
            artifact: {
              kind: "quotation",
              id: `${next.consultationId}/v${event.receipt.quote.version}`,
            },
          },
        );
        // The existing printer reacts only to this event, after confirmQuote has succeeded.
        emit(
          "run.completed",
          null,
          "completed",
          `견적 v${event.receipt.quote.version}의 승인과 저장을 마쳤습니다. ${event.receipt.message}`,
        );
        break;
      case "ERROR":
        stop(event.message, "failed");
        emit("run.failed", null, "failed", event.message, {
          error: { code: "CONSULT_REQUEST_FAILED", message: event.message, retryable: true },
        });
        break;
      case "EDIT_QUOTE":
        revision(
          `${CATEGORY_LABELS[event.category]} 변경 요청을 받았습니다. 변경한 견적은 다시 승인해 주세요.`,
        );
        break;
      case "VISIT_STEP":
        revision(
          `${currentCategory(next) ? CATEGORY_LABELS[currentCategory(next)!] : "부품"} 선택을 다시 확인합니다. 바뀌면 뒤의 부품도 다시 확인합니다.`,
        );
        break;
      case "SET_CONDITIONS":
        if (previous.conditions.color !== event.color || previous.conditions.note !== event.note)
          revision(
            `후보 조건을 바꿨습니다.${event.color ? ` 색상: ${event.color}.` : ""}${event.note ? ` 요청: ${event.note}` : ""}`,
          );
        break;
      case "OPEN_BUDGET":
        stop("예산을 조정하기 위해 후보 조회를 멈췄습니다.");
        needsInput(`${label}에 얼마까지 쓸지 입력해 주세요.`);
        break;
      case "BUDGET_PROPOSAL":
        start("design", "계산된 예산 대체안을 정리하고 있습니다. · 간이 판단");
        finish("design", event.proposal.explanation);
        needsInput("변경 전후 총액과 대체 부품을 확인하고 예산 조정을 선택해 주세요.");
        break;
      case "ACCEPT_BUDGET":
        revision(
          "요청하신 부품 예산과 대체 부품을 반영했습니다. 바뀐 구성으로 다시 확인합니다. · 간이 판단",
        );
        break;
      case "REJECT_BUDGET":
        needsInput("이전 예산을 유지했습니다. 후보를 다시 확인해 주세요.");
        break;
      case "CANCEL_EDIT": {
        revision("변경 요청을 취소하고 이전 구성과 견적을 복원했습니다.");
        const quote = currentQuote(next);
        if (quote) {
          start("quotation", "이전 견적 기록을 확인하고 있습니다.");
          finish(
            "quotation",
            `견적 v${quote.version} · ${won(quote.total_amount)} (테스트 가격) · ${quote.status === "CONFIRMED" ? "이미 승인·저장한 기록" : "승인 대기"}`,
          );
          needsInput(
            quote.status === "CONFIRMED"
              ? "이미 승인·저장한 견적을 다시 확인할 수 있습니다."
              : "복원한 견적을 확인하고 승인해 주세요.",
            null,
          );
        }
        break;
      }
      default:
        break;
    }
    return events;
  }

  return { transition, reset, cancel: () => active.clear() };
}
