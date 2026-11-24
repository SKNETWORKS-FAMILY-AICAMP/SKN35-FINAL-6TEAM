import type { ChatMessage } from "../../api/client";
import { initialChatState, type ChatState } from "../chat/chatState";
import { PROBLEM_OPTIONS, PURPOSE_LABELS } from "./data/demoRules";
import {
  currentCategory,
  currentQuote,
  remainingBudget,
  type ConsultEvent,
  type ConsultState,
} from "./state";
import { CATEGORY_LABELS, won, type CandidateResult, type Survey } from "./types";

type Line = { role: "user" | "assistant"; content: string };
const LOCAL_SESSION = "pc-consult-demo";
const user = (content: string): Line => ({ role: "user", content });
const assistant = (content: string): Line => ({ role: "assistant", content });

/** Local demo transcript only. This never claims a server-saved message or an NLU result.
 * The caller supplies time; omitted timestamps remain explicitly unknown in ChatPanel.
 * Team activity belongs to teamNotesForOffice, never to these customer messages. */
function append(chat: ChatState, lines: Line[], sessionId: string, now?: string): ChatState {
  if (!lines.length) return chat;
  let id = chat.messages.reduce((largest, message) => Math.max(largest, message.id), 0);
  const messages: ChatMessage[] = lines.map((line) => ({
    ...line,
    id: ++id,
    session_id: sessionId,
    created_at: now ?? "",
    nlu: null,
    quick_replies: [],
  }));
  return { messages: [...chat.messages, ...messages], pending: null, error: null };
}

export function initialConsultChatState(now?: string): ChatState {
  return append(
    initialChatState(),
    [
      assistant(
        "개인용 PC 상담 시연입니다. 아래에서 상담 유형과 조건을 선택해 주세요. 음성이나 글로 보내신 요청은 메모로 남습니다.",
      ),
    ],
    LOCAL_SESSION,
    now,
  );
}

export function appendConsultMessage(
  chat: ChatState,
  text: string,
  now?: string,
  result?: CandidateResult | null,
): ChatState {
  const memo = text.trim();
  if (!memo) return chat;
  let reply =
    "요청을 메모했습니다. 아래 선택 항목에서 반영해 주세요. 이 시연에서는 메모만으로 추천이나 견적이 바뀌지 않습니다.";
  if (
    /왜|이유|근거|안\s*(?:보|떠|나와)/.test(memo) &&
    /추천|후보|없|제외|안\s*(?:보|떠|나)/.test(memo)
  ) {
    const recommended = result?.passed.find((item) => item.recommended);
    if (!result) reply = "후보를 조회하면 현재 목록의 기준을 알려드릴게요.";
    else if (recommended && /추천/.test(memo) && !/안\s|제외/.test(memo))
      reply = `이번 시연 목록의 첫 추천은 ${recommended.part.name}입니다. ${recommended.reason}`;
    else
      reply = [
        `현재 시연 목록의 제외 후보는 ${result.rejectedCount}개입니다.`,
        ...result.criteria.slice(0, 2),
      ].join(" ");
  }
  return append(
    chat,
    [user(memo), assistant(reply)],
    chat.messages.at(-1)?.session_id ?? LOCAL_SESSION,
    now,
  );
}

function surveySummary(survey: Survey): string {
  const sections = [
    `${survey.mode === "new" ? "신규 PC 조립" : "기존 PC 부품 교체"}을 원합니다.`,
    `전체 예산은 ${won(survey.budget)}입니다.`,
    `사용 목적: ${survey.purposes.map((purpose) => PURPOSE_LABELS[purpose]).join(" · ") || "미입력"}.`,
  ];
  if (survey.mode === "new") {
    const resolution = { fhd: "FHD", qhd: "QHD", "4k": "4K" }[survey.resolution];
    sections.push(
      `목표: ${resolution} · ${survey.frameRate}프레임, 작업 규모 ${survey.workScale === "large" ? "큰 작업" : "기본 작업"}.`,
    );
  } else {
    const owned = Object.values(survey.owned).map(
      (item) =>
        `${CATEGORY_LABELS[item.category]} ${item.part?.name ?? item.name}${item.part ? "" : " (미확인)"}`,
    );
    const problems = PROBLEM_OPTIONS.filter((option) => survey.problems.includes(option.id)).map(
      (option) => option.label,
    );
    sections.push(
      `보유 부품: ${owned.join(" · ") || "미입력"}.`,
      `지금 겪는 문제: ${problems.join(" · ") || "미입력"}.`,
    );
  }
  if (survey.problemNote.trim()) sections.push(`추가 메모: ${survey.problemNote.trim()}`);
  return sections.join("\n");
}

function budgetSummary(state: ConsultState): string {
  const remaining = remainingBudget(state);
  return remaining < 0
    ? `현재 예산보다 ${won(-remaining)} 초과했습니다.`
    : `남은 예산은 ${won(remaining)}입니다.`;
}

/** Only accepted reducer transitions become dialogue. No progress/worker log is invented. */
export function appendConsultTransition(
  chat: ChatState,
  event: ConsultEvent,
  prev: ConsultState,
  next: ConsultState,
  now?: string,
): ChatState {
  if (prev === next) return chat;
  const sessionId = next.consultationId || prev.consultationId || LOCAL_SESSION;
  const category = currentCategory(prev);
  const categoryLabel = category ? CATEGORY_LABELS[category] : "부품";
  let lines: Line[] = [];
  switch (event.type) {
    case "CHOOSE_MODE":
      if (next.screen !== "survey" || next.survey?.mode !== event.mode) break;
      lines = [
        user(
          event.mode === "new" ? "새 PC를 조립하고 싶어요." : "기존 PC의 부품을 교체하고 싶어요.",
        ),
        assistant(
          "설문에 예산과 사용 목적을 적어 주세요. 입력한 내용을 확인한 뒤 상담을 시작합니다.",
        ),
      ];
      break;
    case "SURVEY_REVIEW":
      if (next.screen !== "review" || next.survey !== event.survey) break;
      lines = [
        user(surveySummary(event.survey)),
        assistant(
          "입력하신 내용을 정리했습니다. 설문 확인 화면에서 내용을 확인하거나 고쳐 주세요.",
        ),
      ];
      break;
    case "EDIT_SURVEY":
      if (next.screen === "survey") lines = [user("설문 내용을 수정할게요.")];
      break;
    case "START":
      if (next.screen !== "selection" || next.error || next.consultationId !== event.consultationId)
        break;
      lines = [
        user("확인한 설문으로 상담을 시작해 주세요."),
        assistant(
          "부품을 하나씩 선택해 주세요. 추천 이유와 확인이 필요한 조건을 함께 살펴보실 수 있습니다.",
        ),
      ];
      break;
    case "SELECT": {
      const chosen = category ? next.selected[category] : undefined;
      if (
        !chosen ||
        chosen.source_key !== event.candidate.part.source_key ||
        next.candidates !== null
      )
        break;
      const validation = category ? next.validations[category] : undefined;
      const note =
        validation?.status === "UNKNOWN"
          ? " 확인 불가 경고를 확인하고 선택합니다."
          : validation?.status === "CONDITIONAL"
            ? " 조건부 지원 내용을 확인하고 선택합니다."
            : "";
      lines = [
        user(`${categoryLabel}는 ${chosen.name}으로 선택할게요.${note}`),
        assistant(
          `선택 내역에 반영했습니다. ${budgetSummary(next)}${next.needsReview.length ? " 뒤에서 선택한 부품은 다시 확인이 필요합니다." : ""}`,
        ),
      ];
      break;
    }
    case "VISIT_STEP":
      if (next.screen === "selection" && next.stepIndex === event.index && currentCategory(next))
        lines = [user(`${CATEGORY_LABELS[currentCategory(next)!]} 선택을 다시 확인할게요.`)];
      break;
    case "OPEN_BUDGET":
      if (next.screen === "budget")
        lines = [
          user(`${categoryLabel}에 쓸 예산을 바꾸고 싶어요.`),
          assistant(
            "이 부품에 얼마까지 쓰실지 입력해 주세요. 다른 부품을 바꾸는 제안은 수락한 뒤 적용됩니다.",
          ),
        ];
      break;
    case "BUDGET_PROPOSAL": {
      if (!category || next.budgetProposal !== event.proposal || next.screen !== "budget") break;
      const requested = event.amount ?? event.proposal.allocations[category];
      lines = [
        user(`${categoryLabel} 예산을 ${won(requested)}으로 검토해 주세요.`),
        assistant(
          "예산 배분안을 확인해 주세요. 아직 기존 선택이나 배정 금액을 바꾸지는 않았습니다.",
        ),
      ];
      break;
    }
    case "ACCEPT_BUDGET":
      if (
        !prev.budgetProposal ||
        !next.plan ||
        next.screen !== "selection" ||
        next.budgetProposal !== null
      )
        break;
      lines = [
        user("예산 배분안과 표시된 대체 부품을 적용할게요."),
        assistant(
          `수락하신 예산 배분안을 반영했습니다. ${budgetSummary(next)}${next.needsReview.length ? " 영향을 받는 부품은 다시 확인해 주세요." : ""}`,
        ),
      ];
      break;
    case "REJECT_BUDGET":
      if (next.screen === "selection")
        lines = [user("예산 변경을 취소하고 기존 선택을 유지할게요.")];
      break;
    case "QUOTE_READY": {
      const quote = currentQuote(next);
      if (
        !quote ||
        next.screen !== "quote" ||
        next.quotes.length !== prev.quotes.length + 1 ||
        quote.version !== event.quote.version
      )
        break;
      lines = [
        assistant(
          `견적 v${quote.version}을 확인해 주세요. 부품 ${quote.items.length}개, 총액 ${won(quote.total_amount)}입니다. 테스트 가격이며 아직 승인 전입니다.${quote.validation.status === "UNKNOWN" ? " 확인 불가 항목도 함께 확인해 주세요." : quote.validation.status === "CONDITIONAL" ? " 조건부 지원 사항도 함께 확인해 주세요." : ""}`,
        ),
      ];
      break;
    }
    case "EDIT_QUOTE":
      if (next.editingCategory !== event.category || !next.editBackup) break;
      lines = [
        user(
          `${CATEGORY_LABELS[event.category]} 변경을 요청합니다.${next.conditions.color ? ` 원하는 색상: ${next.conditions.color}.` : ""}${next.conditions.note ? ` 요청 메모: ${next.conditions.note}` : ""}`,
        ),
        assistant(
          "해당 부품의 후보를 다시 선택해 주세요. 변경을 확정하면 새 견적 버전으로 다시 승인을 받습니다.",
        ),
      ];
      break;
    case "SET_CONDITIONS":
      if (
        prev.conditions.color === next.conditions.color &&
        prev.conditions.note === next.conditions.note
      )
        break;
      lines = [
        user(
          `후보 조건을 변경할게요. 색상: ${next.conditions.color || "제한 없음"}.${next.conditions.note ? ` 요청 메모: ${next.conditions.note}` : ""}`,
        ),
      ];
      break;
    case "CANCEL_EDIT":
      if (prev.editBackup && next.screen === "quote" && next.editBackup === null)
        lines = [
          user("부품 변경 요청을 취소할게요."),
          assistant("기존 견적과 선택 내역을 유지했습니다."),
        ];
      break;
    case "CONFIRM_REQUEST": {
      const quote = currentQuote(prev);
      if (!quote || !next.savePending || next.requestId !== event.requestId) break;
      lines = [
        user(
          `견적 v${quote.version}, 부품 ${quote.items.length}개, 총액 ${won(quote.total_amount)}으로 확정할게요.`,
        ),
      ];
      break;
    }
    case "CONFIRMED":
      if (
        next.screen !== "saved" ||
        !next.receipt ||
        next.receipt === prev.receipt ||
        next.receipt.quote.status !== "CONFIRMED"
      )
        break;
      lines = [
        assistant(
          next.receipt.storage === "memory"
            ? `견적 v${next.receipt.quote.version}을 시연 저장했습니다. DB에 기록되지 않으며 새로고침하면 내역이 사라집니다.`
            : `견적 v${next.receipt.quote.version}을 저장했습니다.`,
        ),
      ];
      break;
    case "PAYMENT":
      if (next.screen === "payment" && next.receipt)
        lines = [
          user("저장한 견적의 결제 안내를 확인할게요."),
          assistant("구성과 금액을 확인한 뒤 모의 결제를 진행해 주세요."),
        ];
      break;
    case "RESTART":
      if (next.screen === "start") lines = [user("상담을 처음부터 다시 시작할게요.")];
      break;
    default:
      break;
  }
  return append(chat, lines, sessionId, now);
}
