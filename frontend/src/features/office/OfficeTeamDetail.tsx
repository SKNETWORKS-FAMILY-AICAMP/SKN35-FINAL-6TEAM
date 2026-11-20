import { useEffect, useRef } from "react";
import type { AgentEvent, Team } from "../../api/client";
import { OfficeScene } from "./OfficeScene";
import { printOut, runStopped, teamHalted } from "./officeCues";
import { eventClock, teamPreview } from "./officePreview";
import { STATUS_LABELS, TEAM_LABELS, TEAMS, type OfficeState } from "./officeState";

const WORKBENCH: Record<Team, { title: string; subtitle: string; received: string }> = {
  consultation: {
    title: "고객의 요청을 정리하는 상담 데스크",
    subtitle: "받은 요구사항과 고객 확인이 필요한 내용을 함께 살펴보세요.",
    received: "접수한 요구사항",
  },
  design: {
    title: "조건에 맞는 구성을 찾는 설계 작업실",
    subtitle: "후보를 찾은 근거와 다음 팀에 전달하는 내용을 살펴보세요.",
    received: "후보 탐색 기록",
  },
  validation: {
    title: "후보를 함께 확인하는 검증 작업실",
    subtitle: "동시에 진행하는 작업과 실제로 도착한 검증 결과를 살펴보세요.",
    received: "받은 검증 기록",
  },
  quotation: {
    title: "선택한 구성을 정리하는 견적 데스크",
    subtitle: "견적 작성과 고객 승인, 최종 완료를 구분해 확인하세요.",
    received: "견적 처리 기록",
  },
};

function eventLabel(event: AgentEvent): string {
  switch (event.type) {
    case "requirements.updated":
      return "요청 접수";
    case "task.started":
      return "작업 시작";
    case "task.progress":
      return "진행 기록";
    case "task.completed":
      return "작업 완료";
    case "task.failed":
      return "작업 실패";
    case "task.retrying":
      return "다시 시도";
    default:
      return STATUS_LABELS[event.status];
  }
}

/** 대화와 동일한 수신 이벤트만 표시합니다. 그림의 움직임은 진행률이나 완료를 만들지 않습니다. */
export function OfficeTeamDetail({
  state,
  team,
  id,
  paused,
  onClose,
  onSelectTeam,
}: {
  state: OfficeState;
  team: Team;
  id: string;
  paused: boolean;
  onClose: () => void;
  onSelectTeam: (team: Team) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const current = state.teams[team];
  const preview = teamPreview(state, team);
  const halted = teamHalted(state, team);
  const working = current.status === "running" && !halted;
  const records = current.log.filter((event) => event.requirement_version === state.version);
  const meaningful = records.slice(-4).reverse();
  const printed = team === "quotation" && printOut(state) !== null;
  const status = halted ? "멈춤" : STATUS_LABELS[current.status];
  const workbench = WORKBENCH[team];

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  function close() {
    dialogRef.current?.close();
    onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      id={id}
      className={`office-focus-dialog office-team-${team}`}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      data-motion={paused || runStopped(state) ? "paused" : "playing"}
      data-testid="office-work-detail"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") event.stopPropagation();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className="office-focus-shell">
        <header className="office-focus-header">
          <div>
            <span className="office-focus-eyebrow">
              업무실 자세히 보기 · 요구사항 v{state.version}
            </span>
            <h2 id={`${id}-title`}>{TEAM_LABELS[team]}</h2>
            <p id={`${id}-description`}>{workbench.subtitle}</p>
          </div>
          <button
            type="button"
            className="office-focus-close"
            onClick={close}
            autoFocus
            aria-label="업무실 닫기"
          >
            <span aria-hidden="true">×</span>
            <span>닫기</span>
          </button>
        </header>
        <nav className="office-focus-tabs" aria-label="살펴볼 업무팀">
          {TEAMS.map((item) => (
            <button
              key={item}
              type="button"
              className={`office-team-${item}`}
              aria-pressed={item === team}
              onClick={() => onSelectTeam(item)}
            >
              <span
                className={`office-team-dot status-${state.teams[item].status}`}
                aria-hidden="true"
              />
              {TEAM_LABELS[item]}
              <small>
                {teamHalted(state, item) ? "멈춤" : STATUS_LABELS[state.teams[item].status]}
              </small>
            </button>
          ))}
        </nav>
        <div className="office-focus-grid">
          <section
            className={`office-workbench status-${current.status}${halted ? " is-halted" : ""}`}
            aria-label={`${TEAM_LABELS[team]} 현재 업무`}
          >
            <div className="office-workbench-heading">
              <span className="office-workbench-mark" aria-hidden="true">
                ▦
              </span>
              <div>
                <span>지금 이 작업실에서는</span>
                <h3>{workbench.title}</h3>
              </div>
              <span
                className={`office-work-status status-${halted ? "cancelled" : current.status}`}
              >
                {status}
              </span>
            </div>
            <div className="office-room-window">
              <OfficeScene state={state} focusTeam={team} />
              <span className="office-window-caption">
                {working
                  ? "직원들이 받은 작업을 처리하고 있어요"
                  : halted
                    ? "진행이 멈춘 작업실이에요"
                    : current.status === "needs_input"
                      ? "고객의 선택을 기다리고 있어요"
                      : "마지막으로 받은 상태를 보여 드려요"}
              </span>
            </div>
            <div className="office-task-monitor">
              <div className="office-monitor-top">
                <span>
                  <i className={working ? "is-working loop" : ""} />
                  실시간 작업 화면
                </span>
                <small>수신 기록 #{records.at(-1)?.seq ?? "—"}</small>
              </div>
              <p className="office-monitor-message">
                {preview.currentWork ||
                  "아직 받은 작업이 없어요. 상담을 시작하면 여기에 실제 작업이 표시돼요."}
              </p>
              {working && (
                <div className="office-processing-track" aria-label="작업 진행 중">
                  <span className="loop" />
                </div>
              )}
              {preview.latestProgress && preview.latestProgress !== preview.currentWork && (
                <p className="office-monitor-progress">
                  <span>최근 진행</span>
                  {preview.latestProgress}
                </p>
              )}
              {printed && (
                <div className="office-printed-receipt">
                  <span aria-hidden="true">▤</span>
                  <div>
                    <strong>견적서 출력 완료</strong>
                    <p>{state.runEvent?.message}</p>
                  </div>
                </div>
              )}
              {team === "quotation" && current.status === "completed" && !printed && (
                <p className="office-monitor-notice">
                  팀의 작성 작업은 끝났어요. 최종 완료 기록은 아직 도착하지 않았어요.
                </p>
              )}
            </div>
            <dl className="office-work-facts">
              <div>
                <dt>{halted ? "멈춘 작업" : "동시 작업"}</dt>
                <dd>
                  {current.activeTasks}
                  <span>개</span>
                </dd>
              </div>
              <div>
                <dt>이번 버전의 수신 기록</dt>
                <dd>
                  {records.length}
                  <span>건</span>
                </dd>
              </div>
              <div>
                <dt>
                  {preview.elapsedKind === "server" ? "서버 측정 시간" : "시작부터 마지막 기록까지"}
                </dt>
                <dd className="office-time-value">
                  {preview.elapsedKind === "none" ? "시간 기록 없음" : preview.elapsed}
                </dd>
              </div>
            </dl>
            {team === "validation" && current.activeTasks > 0 && (
              <div
                className="office-parallel-work"
                aria-label={`검증 작업 ${current.activeTasks}개 ${halted ? "멈춤" : "진행 중"}`}
              >
                <span>동시 검증 작업</span>
                {Array.from({ length: Math.min(current.activeTasks, 6) }, (_, index) => (
                  <span
                    className={`office-work-slot ${!halted ? "is-working loop" : ""}`}
                    key={index}
                  >
                    작업 {index + 1}
                    <i aria-hidden="true" />
                  </span>
                ))}
                {current.activeTasks > 6 && <span>외 {current.activeTasks - 6}개</span>}
              </div>
            )}
          </section>
          <aside className="office-evidence-panel">
            <div className="office-evidence-heading">
              <span>업무 근거</span>
              <h3>{workbench.received}</h3>
              <p>받은 내용 그대로 보여 드려요.</p>
            </div>
            {meaningful.length === 0 ? (
              <div className="office-evidence-empty">
                <span aria-hidden="true">▤</span>
                <strong>아직 도착한 내용이 없어요</strong>
                <p>다른 팀의 결과나 고객의 요청을 기다려요.</p>
              </div>
            ) : (
              <div className="office-evidence-cards">
                {meaningful.map((event) => (
                  <article
                    key={event.seq}
                    className={`office-evidence-card status-${event.status}`}
                  >
                    <div>
                      <span>{eventLabel(event)}</span>
                      <time dateTime={event.occurred_at}>{eventClock(event)}</time>
                    </div>
                    <p>{event.message}</p>
                    {event.error && <small>{event.error.message}</small>}
                  </article>
                ))}
              </div>
            )}
            <details className="office-focus-history">
              <summary>
                작업 기록 전체 보기 <span>{records.length}</span>
              </summary>
              <ol>
                {records.map((event) => (
                  <li key={event.seq}>
                    <div>
                      <time dateTime={event.occurred_at}>{eventClock(event)}</time>
                      <span>{eventLabel(event)}</span>
                    </div>
                    <p>{event.message}</p>
                  </li>
                ))}
              </ol>
            </details>
          </aside>
        </div>
        <footer className="office-focus-footer">
          <span>움직임은 작업 상태를 표현해요. 완료 여부는 수신한 기록으로만 바뀌어요.</span>
          <button type="button" onClick={close}>
            사무실로 돌아가기 <span aria-hidden="true">↗</span>
          </button>
        </footer>
      </div>
    </dialog>
  );
}
