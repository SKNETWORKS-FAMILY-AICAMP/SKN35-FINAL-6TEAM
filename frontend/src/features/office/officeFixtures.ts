/**
 * 사무실 상태 견본. 상태마다 이벤트 배열을 두고 officeReducer 로 접어서 화면 상태를 만듭니다.
 * 상태 객체를 직접 지어내지 않습니다. 개발용 견본 화면(OfficeGallery)과 시험이 함께 씁니다.
 */
import type { AgentEvent, EventError, Team, WorkStatus } from "../../api/client";
import { buildMockEvents } from "./officeEvent.fixture";
import { initialOfficeState, officeReducer, type OfficeState } from "./officeState";

export interface OfficeFixture {
  id: string;
  title: string;
  note: string;
  events: AgentEvent[];
  /** 다시 시도 버튼을 연결할지(버튼이 보이는 조건은 화면이 따로 판단합니다). */
  retry?: boolean;
}

// 견본 시각은 고정합니다. 2026-11-16 10:00:00(한국 시각)부터 0.7초 간격.
const BASE_TIME = Date.parse("2026-11-16T01:00:00Z");
const STEP_MS = 700;
const SESSION = "gallery-session";

function at(seq: number): string {
  return new Date(BASE_TIME + (seq - 1) * STEP_MS).toISOString();
}

/** 기본 시연 대본의 앞부분. 시각만 고정값으로 바꿉니다. */
function script(count: number): AgentEvent[] {
  return buildMockEvents(SESSION, 0)
    .slice(0, count)
    .map((event) => ({ ...event, occurred_at: at(event.seq) }));
}

function then(
  events: AgentEvent[],
  type: AgentEvent["type"],
  status: WorkStatus,
  team: Team | null,
  message: string,
  error: EventError | null = null,
): AgentEvent[] {
  const seq = events.length + 1;
  return [
    ...events,
    {
      seq,
      session_id: SESSION,
      company_id: 0,
      run_id: type === "requirements.updated" ? null : "mock-run",
      requirement_version: 1,
      team,
      type,
      status,
      occurred_at: at(seq),
      message,
      error,
      artifact: null,
      metrics: null,
    },
  ];
}

function quoteFailure(retryable: boolean): AgentEvent[] {
  const error: EventError = {
    code: "PRICE_UNCONFIRMED",
    message: "가격을 확인하지 못한 상품이 있어요",
    retryable,
  };
  let events = then(
    script(11),
    "task.failed",
    "failed",
    "quotation",
    "가격을 확인하지 못한 상품이 있어요",
    error,
  );
  events = then(events, "run.failed", "failed", null, "견적을 만들지 못했습니다", error);
  return events;
}

function needsInput(): AgentEvent[] {
  let events = then(
    script(3),
    "task.needs_input",
    "needs_input",
    "design",
    "조건에 맞는 상품이 없습니다. 예산이나 조건을 바꿔 주세요.",
  );
  events = then(events, "run.needs_input", "needs_input", "consultation", "고객 확인이 필요합니다");
  return events;
}

function needsRevision(): AgentEvent[] {
  let events = then(
    script(8),
    "task.completed",
    "completed",
    "validation",
    "노트북 A: 부적합 · 화면 13인치 (조건 15인치 이상)",
  );
  events = then(
    events,
    "task.completed",
    "completed",
    "validation",
    "노트북 B: 부적합 · 메모리 16GB (조건 32GB 이상)",
  );
  events = then(
    events,
    "run.needs_revision",
    "needs_revision",
    "design",
    "노트북 후보가 모두 검증에서 탈락했습니다. 조건을 바꾸거나 다시 설계해야 합니다.",
  );
  return events;
}

function cancelled(): AgentEvent[] {
  // 계약에 취소 전용 이벤트 종류가 아직 없어서 상태값(cancelled)으로만 나타냅니다.
  let events = then(
    script(7),
    "task.failed",
    "cancelled",
    "validation",
    "고객이 요청을 취소해 검증을 멈췄어요",
  );
  events = then(events, "run.failed", "cancelled", null, "고객이 요청을 취소했어요");
  return events;
}

function longMessages(): AgentEvent[] {
  let events = then(
    [],
    "requirements.updated",
    "completed",
    "consultation",
    "요구사항 v1 정리: 영상 편집과 3D 렌더링을 함께 하는 데스크톱 · 예산 4,500,000원 · 메모리 64GB 이상 · 저장장치 4TB 이상 · 조용한 냉각 · 모니터 두 대 연결",
  );
  events = then(events, "run.started", "running", null, "요구사항 v1 작업 시작");
  events = then(events, "task.started", "running", "design", "후보 탐색 시작");
  events = then(
    events,
    "task.progress",
    "running",
    "design",
    "후보 1: 가상 브랜드 워크스테이션 프로 아주 긴 모델 이름 2026 에디션 (메모리 64GB · 저장장치 4TB · 그래픽 메모리 24GB)",
  );
  events = then(
    events,
    "task.started",
    "running",
    "validation",
    "검증: 가상 브랜드 워크스테이션 프로 아주 긴 모델 이름 2026 에디션의 전원 용량과 케이스 공간 확인 시작",
  );
  return events;
}

export const OFFICE_FIXTURES: OfficeFixture[] = [
  { id: "idle", title: "대기", note: "아직 받은 요청이 없어요.", events: [] },
  {
    id: "design",
    title: "설계·분석팀 진행 중",
    note: "상담팀이 정리한 요청서를 설계·분석팀이 받아 후보를 찾고 있어요.",
    events: script(4),
  },
  {
    id: "validation-parallel",
    title: "검증 2건 동시",
    note: "검증팀이 후보 두 개를 같이 보고 있어요.",
    events: script(7),
  },
  {
    id: "needs-input",
    title: "고객 확인 필요",
    note: "조건에 맞는 상품이 없어 고객에게 다시 물어야 해요.",
    events: needsInput(),
  },
  {
    id: "needs-revision",
    title: "재검토 필요",
    note: "후보가 모두 검증에서 떨어져 설계를 다시 봐야 해요.",
    events: needsRevision(),
  },
  {
    id: "retrying",
    title: "다시 시도 중",
    note: "견적·주문팀이 같은 작업을 다시 하고 있어요.",
    events: then(
      script(11),
      "task.retrying",
      "running",
      "quotation",
      "참고 견적 작성 다시 시도 (2/3)",
    ),
  },
  {
    id: "failed-retryable",
    title: "실패 · 다시 시도할 수 있음",
    note: "다시 시도 버튼이 실패한 방 옆과 지도 위 오류 줄에 나와요.",
    events: quoteFailure(true),
    retry: true,
  },
  {
    id: "failed-final",
    title: "실패 · 다시 시도할 수 없음",
    note: "다시 시도할 수 없는 오류라 버튼을 두지 않아요.",
    events: quoteFailure(false),
    retry: true,
  },
  {
    id: "superseded",
    title: "새 요청으로 중단",
    note: "작업 중에 새 요구사항이 들어와 이번 작업을 닫았어요.",
    events: then(
      script(7),
      "run.superseded",
      "superseded",
      null,
      "새 요구사항이 들어와 이 작업을 닫았습니다",
    ),
  },
  {
    id: "cancelled",
    title: "취소",
    note: "고객이 요청을 취소했어요.",
    events: cancelled(),
  },
  {
    id: "long-message",
    title: "아주 긴 메시지",
    note: "방 메시지와 지도 아래 띠가 말줄임으로 끊기는지 봐요.",
    events: longMessages(),
  },
  {
    id: "completed",
    title: "완료",
    note: "네 팀이 모두 끝내고 견적서가 출력됐어요.",
    events: script(13),
  },
];

export function fixtureState(fixture: OfficeFixture): OfficeState {
  return fixture.events.reduce(officeReducer, initialOfficeState());
}
