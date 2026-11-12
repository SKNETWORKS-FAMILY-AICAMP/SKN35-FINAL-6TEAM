import { useEffect, useId, useRef, useState } from "react";
import type { Team } from "../../api/client";
import { OfficeScene } from "./OfficeScene";
import { eventClock, teamPreview } from "./officePreview";
import {
  STATUS_LABELS,
  TEAM_LABELS,
  TEAMS,
  type DisplayStatus,
  type OfficeState,
} from "./officeState";
import "./office.css";

interface Props {
  state: OfficeState;
  onRetry?: () => void;
}

function TeamIcon({ team }: { team: Team }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      {team === "consultation" && (
        <>
          <path d="M5 5h14v10H9l-4 4V5Z" />
          <path d="M8 9h8M8 12h5" />
        </>
      )}
      {team === "design" && (
        <>
          <path d="m12 4 9 5-9 5-9-5 9-5Z" />
          <path d="m4 13 8 4 8-4M4 17l8 4 8-4" />
        </>
      )}
      {team === "validation" && (
        <>
          <path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z" />
          <path d="m8 12 3 3 5-6" />
        </>
      )}
      {team === "quotation" && (
        <>
          <path d="M6 3h9l4 4v14H6V3Z" />
          <path d="M14 3v5h5M9 12h7M9 16h5" />
        </>
      )}
    </svg>
  );
}

export function OfficeBoard({ state, onRetry }: Props) {
  const [open, setOpen] = useState<Team | null>(null);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(true);
  const [hoveredTeam, setHoveredTeam] = useState<Team | null>(null);
  const [focusedTeam, setFocusedTeam] = useState<Team | null>(null);
  const [tappedTeam, setTappedTeam] = useState<Team | null>(null);
  const boardRef = useRef<HTMLElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const roomRefs = useRef<Partial<Record<Team, HTMLButtonElement | null>>>({});
  const detailId = useId();
  const previewId = useId();
  const previewTeam = hoveredTeam ?? focusedTeam ?? tappedTeam ?? open;
  const preview = previewTeam ? teamPreview(state, previewTeam) : null;
  const canRetry = state.runStatus === "failed" && state.runError?.retryable && onRetry;
  const completed = TEAMS.filter((team) => state.teams[team].status === "completed").length;
  const running = TEAMS.filter((team) => state.teams[team].status === "running").length;
  const latestTeamEvent = TEAMS.flatMap((team) => state.teams[team].log).sort(
    (first, second) => second.seq - first.seq,
  )[0];
  const stopped = ["failed", "cancelled", "superseded"].includes(state.runStatus);
  const settled =
    stopped || ["completed", "needs_input", "needs_revision"].includes(state.runStatus);
  const summaries: Record<DisplayStatus, string> = {
    idle: "요청을 기다리고 있어요",
    pending: "요청을 준비하고 있어요",
    running: running ? `${running}개 팀이 일하고 있어요` : "팀의 작업 결과를 기다리고 있어요",
    completed: "요청 처리가 완료되었어요",
    needs_input: "고객의 확인을 기다리고 있어요",
    needs_revision: "조건을 다시 검토해야 해요",
    failed: "작업 중 문제가 발생했어요",
    cancelled: "요청이 취소되었어요",
    superseded: "새 요청으로 변경되어 중단되었어요",
  };

  function closeDetail() {
    if (open) roomRefs.current[open]?.focus();
    setOpen(null);
  }

  useEffect(() => {
    if (!open) return;
    detailRef.current?.focus({ preventScroll: true });
    detailRef.current?.scrollIntoView({ block: "nearest", behavior: "auto" });
  }, [open]);

  // Presentation only: pausing or hiding the scene never stops the event stream.
  useEffect(() => {
    const board = boardRef.current;
    if (!board || typeof IntersectionObserver === "undefined") return;
    let inView = true;
    const update = () => setVisible(inView && !document.hidden);
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      update();
    });
    observer.observe(board);
    document.addEventListener("visibilitychange", update);
    update();
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  return (
    <section
      ref={boardRef}
      id="workspace"
      className="panel office-board"
      aria-label="AI 오피스"
      data-motion={paused || !visible || settled ? "paused" : "playing"}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        if (open) closeDetail();
        setHoveredTeam(null);
        setFocusedTeam(null);
        setTappedTeam(null);
      }}
      onPointerDown={(event) => {
        if (!(event.target instanceof Element) || !event.target.closest(".office-room")) {
          setTappedTeam(null);
        }
      }}
    >
      <header className="office-header">
        <div className="office-heading">
          <h2>AI 팀 오피스</h2>
          <p className="office-intro">상담부터 견적까지, 네 팀이 함께합니다.</p>
        </div>
        <div className="office-header-actions">
          <span
            className={`office-run status-${state.runStatus}`}
            data-testid="run-status"
            role="status"
          >
            <i aria-hidden="true" />
            {state.version ? `요구사항 v${state.version} · ` : ""}
            {STATUS_LABELS[state.runStatus]}
          </span>
          <button
            type="button"
            className="office-motion-button"
            aria-pressed={paused}
            title="캐릭터 움직임만 조절하며 업무 상태는 계속 갱신됩니다"
            onClick={() => setPaused(!paused)}
          >
            <span aria-hidden="true">{paused ? "▷" : "Ⅱ"}</span>
            {paused ? "움직임 재생" : "움직임 정지"}
          </button>
        </div>
      </header>
      <div className="office-workspace">
        <aside className="office-sidebar" aria-label="오피스 현황">
          <div className="office-summary-heading">
            <p className="office-summary-copy" role="status">
              {summaries[state.runStatus]}
            </p>
            <span className="office-team-total" aria-label={`완료된 팀 ${completed} / 4`}>
              <strong>{completed}</strong>
              <span> / 4팀 완료</span>
            </span>
          </div>
          <ul className="office-team-list">
            {TEAMS.map((team) => (
              <li
                key={team}
                className={`office-team-card office-team-${team} status-${state.teams[team].status}`}
              >
                <button
                  type="button"
                  aria-expanded={open === team}
                  aria-controls={open === team ? detailId : undefined}
                  onClick={() => setOpen(open === team ? null : team)}
                >
                  <span className={`office-team-avatar office-avatar-${team}`} aria-hidden="true">
                    <TeamIcon team={team} />
                  </span>
                  <span className="office-team-card-copy">
                    <strong>{TEAM_LABELS[team]}</strong>
                    <span>
                      <i className="office-team-light" aria-hidden="true" />
                      {STATUS_LABELS[state.teams[team].status]}
                      {state.teams[team].status === "running" && state.teams[team].activeTasks > 0
                        ? ` · ${state.teams[team].activeTasks}개 작업`
                        : ""}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <div className="office-floor-column">
          <div className="office-map-toolbar">
            <span>워크스페이스</span>
            <span className="office-map-instruction">
              팀 위에 올려 보기 · 클릭해 기록 보기 <b>2×</b>
            </span>
          </div>
          <div
            className="office-map-viewport"
            tabIndex={0}
            role="region"
            aria-label="사무실 지도, 팀을 선택하면 현재 작업과 기록을 볼 수 있습니다"
          >
            <div
              className="office-scene"
              data-preview={previewTeam ?? undefined}
              role="group"
              aria-label="네 팀의 픽셀 사무실"
            >
              <OfficeScene state={state} previewTeam={previewTeam} />
              {TEAMS.map((team, index) => {
                const teamState = state.teams[team];
                return (
                  <button
                    type="button"
                    key={team}
                    ref={(node) => {
                      roomRefs.current[team] = node;
                    }}
                    className={`office-room office-room-${team} status-${teamState.status}`}
                    data-testid={`desk-${team}`}
                    data-preview={previewTeam === team ? "active" : previewTeam ? "dim" : undefined}
                    aria-expanded={open === team}
                    aria-controls={open === team ? detailId : undefined}
                    aria-describedby={previewTeam === team ? previewId : undefined}
                    onPointerEnter={(event) => {
                      if (event.pointerType !== "touch") setHoveredTeam(team);
                    }}
                    onPointerLeave={() => setHoveredTeam(null)}
                    onPointerDown={(event) => {
                      if (event.pointerType === "touch") {
                        setHoveredTeam(null);
                        setTappedTeam(team);
                      }
                    }}
                    onPointerCancel={() => setTappedTeam(null)}
                    onFocus={(event) => {
                      if (event.currentTarget.matches(":focus-visible")) {
                        setHoveredTeam(null);
                        setFocusedTeam(team);
                      }
                    }}
                    onBlur={() => {
                      setFocusedTeam(null);
                      setTappedTeam((current) => (current === team ? null : current));
                    }}
                    onClick={() => setOpen(open === team ? null : team)}
                  >
                    <span className="office-room-heading">
                      <span className="office-room-number">0{index + 1}</span>
                      <span className="desk-name">{TEAM_LABELS[team]}</span>
                      <span className="office-room-arrow" aria-hidden="true">
                        ↗
                      </span>
                    </span>
                    <span className="office-room-bottom">
                      <span className="office-team-status">
                        <i aria-hidden="true" />
                        {STATUS_LABELS[teamState.status]}
                      </span>
                      <span className="office-room-message" title={teamState.message}>
                        {teamState.message || "새로운 요청을 기다리고 있어요"}
                      </span>
                    </span>
                  </button>
                );
              })}
              <div className="office-hall-label" aria-hidden="true">
                <span>BUILD</span>WISE <small>TEAM WORKSPACE</small>
              </div>
            </div>
          </div>
          <p className="office-touch-hint">팀을 탭해 현재 작업과 기록을 확인하세요.</p>
          <div className="office-preview-slot" aria-live="polite" aria-atomic="true">
            {preview && previewTeam ? (
              <section
                className={`office-preview office-preview-${previewTeam} status-${state.teams[previewTeam].status}`}
                id={previewId}
                aria-label={`${TEAM_LABELS[previewTeam]} 업무 미리보기`}
                data-testid="office-team-preview"
              >
                <div className="office-preview-heading">
                  <span className={`office-preview-icon office-avatar-${previewTeam}`}>
                    <TeamIcon team={previewTeam} />
                  </span>
                  <strong>{TEAM_LABELS[previewTeam]}</strong>
                  <span className="office-team-status">
                    <i aria-hidden="true" />
                    {preview.status}
                    {preview.activeTasks > 0 ? ` · ${preview.activeTasks}개 작업` : ""}
                  </span>
                  <span className="office-preview-time" title={preview.elapsedBasis}>
                    걸린 시간 <b>{preview.elapsed}</b>
                  </span>
                </div>
                <div className="office-preview-body">
                  <div className="office-preview-task">
                    <span className="office-note-label">현재 작업 · 마지막 이벤트</span>
                    <p>{preview.currentWork || "아직 수신된 작업이 없어요"}</p>
                    {preview.latestProgress && (
                      <p className="office-preview-progress">
                        <span>최근 진행</span> {preview.latestProgress}
                      </p>
                    )}
                    <small>{preview.elapsedBasis}</small>
                  </div>
                  <div className="office-preview-records">
                    <span className="office-note-label">최근 기록</span>
                    <ol aria-label="최근 작업 기록">
                      {preview.recentEvents.length === 0 && <li>아직 기록이 없습니다.</li>}
                      {preview.recentEvents.map((event) => (
                        <li key={event.seq}>
                          <time dateTime={event.occurred_at}>{eventClock(event)}</time>
                          <span>{event.message}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              </section>
            ) : (
              <div className={`office-request status-${state.runStatus}`}>
                <div className="office-request-icon" aria-hidden="true">
                  <TeamIcon team="consultation" />
                </div>
                <div className="office-request-copy">
                  <div className="office-request-heading">
                    <span className="office-note-label">현재 요청</span>
                    {state.version > 0 && (
                      <span className="office-request-version">요구사항 v{state.version}</span>
                    )}
                  </div>
                  <p>{state.runMessage || "상담을 시작하면 네 팀의 작업이 이곳에 표시돼요."}</p>
                  {latestTeamEvent ? (
                    <div className="office-recent-activity">
                      <span>최근 기록</span>
                      <time dateTime={latestTeamEvent.occurred_at}>
                        {eventClock(latestTeamEvent)}
                      </time>
                      <span>{latestTeamEvent.message}</span>
                    </div>
                  ) : (
                    <span className="office-request-help">
                      원하는 장비와 예산을 상담 직원에게 알려주세요.
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
          {state.runError && (
            <div className="office-error error" role="alert">
              <p>
                {state.runError.code}: {state.runError.message}
              </p>
              {canRetry && (
                <button type="button" onClick={onRetry}>
                  다시 시도
                </button>
              )}
            </div>
          )}
          <footer className="office-map-footer">
            <div className="office-legend" aria-label="상태 범례">
              <span>
                <i className="legend-idle" />
                대기
              </span>
              <span>
                <i className="legend-running" />
                진행 중
              </span>
              <span>
                <i className="legend-completed" />
                완료
              </span>
              <span>
                <i className="legend-attention" />
                확인 필요
              </span>
              <span>
                <i className="legend-failed" />
                실패
              </span>
            </div>
            <span className="office-event-count">
              이벤트 #{String(state.lastSeq).padStart(3, "0")}
            </span>
          </footer>
        </div>
      </div>
      {open && (
        <div
          className="office-detail"
          ref={detailRef}
          id={detailId}
          tabIndex={-1}
          role="region"
          aria-label={`${TEAM_LABELS[open]} 전체 작업 기록`}
        >
          <div className="office-detail-heading">
            <div>
              <h3>{TEAM_LABELS[open]} 작업 기록</h3>
              <p>요구사항 v{state.version} · 수신된 이벤트 순서</p>
            </div>
            <button type="button" onClick={closeDetail}>
              기록 닫기 <span aria-hidden="true">×</span>
            </button>
          </div>
          <ol className="desk-log" aria-label={`${TEAM_LABELS[open]} 작업 기록`}>
            {state.teams[open].log.length === 0 && <li>아직 기록이 없습니다.</li>}
            {state.teams[open].log.map((event) => (
              <li key={event.seq}>
                <span className="mono">#{event.seq}</span>{" "}
                <span className={`office-log-status status-${event.status}`}>
                  {STATUS_LABELS[event.status]}
                </span>{" "}
                · {event.message}
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
