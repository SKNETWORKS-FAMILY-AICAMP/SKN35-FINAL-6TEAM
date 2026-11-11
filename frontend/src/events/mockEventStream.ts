/**
 * 가짜 이벤트 대본 — 백엔드 없이 오피스 화면을 만들 때 씁니다.
 * 주소 끝에 ?mock=1 을 붙이면 화면 전체가 이 대본으로 움직입니다.
 * 형식은 실제 이벤트(AgentEventOut)와 같습니다.
 */
import type { AgentEvent, Team, WorkStatus } from "../api/client";
import type { EventStream } from "./eventStream";

type Step = [type: AgentEvent["type"], status: WorkStatus, team: Team | null, message: string];

const SCRIPT: Step[] = [
  [
    "requirements.updated",
    "completed",
    "consultation",
    "요구사항 v1 정리: 노트북 · 예산 2,500,000원",
  ],
  ["run.started", "running", null, "요구사항 v1 작업 시작"],
  ["task.started", "running", "design", "후보 탐색 시작"],
  ["task.progress", "running", "design", "후보 1: 가상 브랜드 노트북 A"],
  ["task.started", "running", "validation", "검증: 노트북 A 시작"],
  ["task.progress", "running", "design", "후보 2: 가상 브랜드 노트북 B"],
  ["task.started", "running", "validation", "검증: 노트북 B 시작"],
  ["task.completed", "completed", "design", "후보 2개를 찾았습니다"],
  ["task.completed", "completed", "validation", "노트북 A: 통과"],
  ["task.completed", "completed", "validation", "노트북 B: 부적합 — 메모리 16GB (조건 32GB 이상)"],
  ["task.started", "running", "quotation", "참고 견적 작성 시작"],
  ["task.completed", "completed", "quotation", "참고 견적 2,190,000원"],
  ["run.completed", "completed", null, "추천 · 검증 · 견적이 끝났습니다"],
];

export function buildMockEvents(sessionId = "mock-session", companyId = 0): AgentEvent[] {
  const start = Date.now();
  return SCRIPT.map(([type, status, team, message], index) => ({
    seq: index + 1,
    session_id: sessionId,
    company_id: companyId,
    run_id: type === "requirements.updated" ? null : "mock-run",
    requirement_version: 1,
    team,
    type,
    status,
    occurred_at: new Date(start + index * 700).toISOString(),
    message,
    error: null,
    artifact: null,
    metrics: null,
  }));
}

export function createMockEventStream(intervalMs = 700): EventStream {
  return {
    subscribe(onEvent, onState) {
      const events = buildMockEvents();
      let index = 0;
      onState("open");
      const timer = setInterval(() => {
        if (index >= events.length) {
          clearInterval(timer);
          return;
        }
        onEvent(events[index]);
        index += 1;
      }, intervalMs);
      return () => {
        clearInterval(timer);
        onState("closed");
      };
    },
  };
}
