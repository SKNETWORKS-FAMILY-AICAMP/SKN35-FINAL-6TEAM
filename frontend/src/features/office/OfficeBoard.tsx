import { useEffect, useId, useRef, useState } from "react";
import type { Team } from "../../api/client";
import { OfficeScene } from "./OfficeScene";
import { OfficeTeamDetail } from "./OfficeTeamDetail";
import { latestQuote, runStopped, teamHalted, validators } from "./officeCues";
import { teamNotesForOffice } from "./officeNotes";
import { clockText, teamPreview, type ElapsedKind } from "./officePreview";
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

type IconKind = "working" | "done" | "attention" | "revision" | "failed" | "idle" | "stopped";

// 12px 픽셀 아이콘(12 단위 격자). 상태 칩은 늘 아이콘과 한글 라벨을 같이 둡니다.
const ICON_PATHS: Record<IconKind, string> = {
  working: "M1 5h2v2H1Zm4 0h2v2H5Zm4 0h2v2H9Z",
  done: "M1 5h2v3H1Zm2 2h2v3H3Zm2-2h2v4H5Zm2-2h2v4H7Zm2-2h2v4H9Z",
  attention: "M4 1h4v2H4ZM2 3h2v2H2Zm6 0h2v2H8ZM6 5h2v2H6ZM5 7h2v1H5Zm0 2h2v2H5Z",
  revision: "M4 1h5v2H4ZM9 3h2v6H9ZM4 9h5v2H4ZM2 7h2v2H2ZM1 1h3v2H1Zm0 2h2v2H1Z",
  failed: "M5 1h2v6H5Zm0 8h2v2H5Z",
  idle: "M2 2h8v8H2ZM4 4v4h4V4Z",
  stopped: "M2 5h8v2H2Z",
};

const ICON_FOR: Record<DisplayStatus, IconKind> = {
  idle: "idle",
  pending: "idle",
  running: "working",
  completed: "done",
  needs_input: "attention",
  needs_revision: "revision",
  failed: "failed",
  cancelled: "stopped",
  superseded: "stopped",
};

const SUMMARIES: Record<Exclude<DisplayStatus, "running">, string> = {
  idle: "요청을 기다리고 있어요",
  pending: "요청을 준비하고 있어요",
  completed: "요청을 모두 완료했어요",
  needs_input: "고객의 확인을 기다리고 있어요",
  needs_revision: "조건을 다시 검토해야 해요",
  failed: "작업 중 문제가 생겼어요",
  cancelled: "요청이 취소됐어요",
  superseded: "새 요청이 들어와 이 작업은 멈췄어요",
};

const ELAPSED_BASIS: Record<ElapsedKind, string> = {
  server: "서버가 잰 최근 작업 시간",
  events: "팀이 시작한 때부터 마지막 기록까지",
  none: "시작 시각이 기록되지 않았어요",
};

const HALT_REASON: Partial<Record<DisplayStatus, string>> = {
  failed: "실행이 실패해 멈췄어요",
  cancelled: "요청이 취소되어 멈췄어요",
  superseded: "새 요청이 들어와 멈췄어요",
};

function PixelIcon({ kind }: { kind: IconKind }) {
  return (
    <svg
      className="office-icon"
      viewBox="0 0 12 12"
      width="12"
      height="12"
      aria-hidden="true"
      focusable="false"
      shapeRendering="crispEdges"
    >
      <path d={ICON_PATHS[kind]} fillRule="evenodd" />
    </svg>
  );
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
  const roomRefs = useRef<Partial<Record<Team, HTMLButtonElement | null>>>({});
  const titleId = useId();
  const detailId = useId();
  const previewId = useId();
  const previewTeam = hoveredTeam ?? focusedTeam ?? tappedTeam ?? open;
  const preview = previewTeam ? teamPreview(state, previewTeam) : null;
  const canRetry = state.runStatus === "failed" && state.runError?.retryable && onRetry;
  const completed = TEAMS.filter((team) => state.teams[team].status === "completed").length;
  const running = TEAMS.filter(
    (team) => state.teams[team].status === "running" && !teamHalted(state, team),
  ).length;
  const stopped = runStopped(state);
  const quote = latestQuote(state);
  const latestNote = teamNotesForOffice(state, 1)[0];
  const request = state.teams.consultation.log.findLast(
    (event) => event.type === "requirements.updated",
  );
  const crew = validators(state);
  const summary =
    state.runStatus === "running"
      ? running
        ? `${running}개 팀이 일하고 있어요`
        : "팀의 작업 결과를 기다리고 있어요"
      : SUMMARIES[state.runStatus];

  function closeDetail() {
    if (open) roomRefs.current[open]?.focus();
    setOpen(null);
  }

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

  function previewState(team: Team) {
    return previewTeam === team ? "active" : previewTeam ? "dim" : undefined;
  }

  function chipIcon(team: Team): IconKind {
    return teamHalted(state, team) ? "stopped" : ICON_FOR[state.teams[team].status];
  }

  // One text node, so the label reads (and tests match) as a single phrase.
  function chipLabel(team: Team): string {
    const { status, activeTasks } = state.teams[team];
    if (teamHalted(state, team)) return `${STATUS_LABELS[status]} · 멈춤`;
    const busy = status === "running" && activeTasks > 0 ? ` · ${activeTasks}개 작업` : "";
    return `${STATUS_LABELS[status]}${busy}`;
  }

  return (
    <section
      ref={boardRef}
      id="workspace"
      className="panel office-board"
      aria-labelledby={titleId}
      data-motion={paused || !visible || stopped ? "paused" : "playing"}
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
        <h2 id={titleId}>AI 팀 사무실</h2>
        <span
          className={`office-run status-${state.runStatus}`}
          data-testid="run-status"
          role="status"
        >
          <PixelIcon kind={ICON_FOR[state.runStatus]} />
          {state.version ? `요구사항 v${state.version} · ` : ""}
          {STATUS_LABELS[state.runStatus]}
        </span>
        <p className="office-summary-copy">{summary}</p>
        <span className="office-done-count">완료 {completed}/4팀</span>
        <button
          type="button"
          className="office-motion-button"
          aria-pressed={paused}
          title="캐릭터 움직임만 멈춥니다. 팀 상태는 계속 바뀝니다."
          onClick={() => setPaused(!paused)}
        >
          <svg
            className="office-icon"
            viewBox="0 0 12 12"
            width="12"
            height="12"
            aria-hidden="true"
            focusable="false"
            shapeRendering="crispEdges"
          >
            <path d="M3 2h2v8H3Zm4 0h2v8H7Z" />
          </svg>
          움직임 멈춤
        </button>
      </header>
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
      <div
        className="office-scene"
        data-preview={previewTeam ?? undefined}
        role="group"
        aria-label="네 팀의 픽셀 사무실"
      >
        <OfficeScene state={state} previewTeam={previewTeam} />
        {TEAMS.map((team) => {
          const teamState = state.teams[team];
          const halted = teamHalted(state, team);
          const icon = chipIcon(team);
          return (
            <button
              type="button"
              key={team}
              ref={(node) => {
                roomRefs.current[team] = node;
              }}
              className={`office-room office-room-${team} status-${teamState.status}${halted ? " is-halted" : ""}`}
              data-testid={`desk-${team}`}
              data-preview={previewState(team)}
              aria-expanded={open === team}
              aria-haspopup="dialog"
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
                <span className="desk-name">{TEAM_LABELS[team]}</span>
                <span
                  className={`office-chip chip-${icon}`}
                  title={halted ? HALT_REASON[state.runStatus] : undefined}
                >
                  <PixelIcon kind={icon} />
                  {chipLabel(team)}
                </span>
              </span>
              <span className="office-room-message" title={teamState.message || undefined}>
                {teamState.message || "새 요청을 기다리고 있어요"}
              </span>
              {team === "validation" && crew.overflow > 0 && (
                <span className="office-room-overflow" aria-hidden="true">
                  +{crew.overflow}
                </span>
              )}
            </button>
          );
        })}
        {canRetry &&
          TEAMS.filter((team) => state.teams[team].status === "failed").map((team) => (
            <button
              type="button"
              key={team}
              className={`office-room-retry retry-${team}`}
              data-preview={previewState(team)}
              aria-label={`${TEAM_LABELS[team]} 작업 다시 시도`}
              onClick={onRetry}
            >
              다시 시도
            </button>
          ))}
      </div>
      <div className="office-preview-slot">
        {preview && previewTeam ? (
          <section
            className={`office-preview office-preview-${previewTeam}`}
            id={previewId}
            aria-label={`${TEAM_LABELS[previewTeam]} 미리보기`}
            data-testid="office-team-preview"
          >
            <span className="office-preview-icon">
              <TeamIcon team={previewTeam} />
            </span>
            <strong className="office-preview-name">{TEAM_LABELS[previewTeam]}</strong>
            <span className={`office-chip chip-${chipIcon(previewTeam)}`}>
              <PixelIcon kind={chipIcon(previewTeam)} />
              {chipLabel(previewTeam)}
            </span>
            {preview.elapsedKind !== "none" && (
              <span className="office-preview-time" title={ELAPSED_BASIS[preview.elapsedKind]}>
                걸린 시간 {preview.elapsed}
              </span>
            )}
            <span className="office-preview-work">
              <span className="office-band-label">지금 하는 일</span>
              <span className="office-preview-work-text" title={preview.currentWork ?? undefined}>
                {preview.currentWork || "아직 받은 작업이 없어요"}
              </span>
            </span>
          </section>
        ) : quote ? (
          <div className="office-quote">
            <span className="office-preview-icon office-preview-quotation" aria-hidden="true">
              <TeamIcon team="quotation" />
            </span>
            <strong className="office-quote-value">{quote.message}</strong>
            <span className="office-quote-note">DB 기준 참고 견적</span>
            <a className="office-quote-link" href="#results">
              결과 보기
            </a>
          </div>
        ) : (
          <div className="office-request">
            <p className="office-request-line">
              <span className="office-band-label">현재 요청</span>
              <span className="office-request-text">
                {request?.message ||
                  state.runMessage ||
                  "상담을 시작하면 네 팀의 작업이 여기에 나와요"}
              </span>
            </p>
            <p
              className={`office-request-line office-recent office-team-${latestNote?.team ?? "none"}`}
            >
              {latestNote ? (
                <>
                  <time dateTime={latestNote.occurredAt}>{clockText(latestNote.occurredAt)}</time>
                  <span className="office-recent-team">{TEAM_LABELS[latestNote.team]}</span>
                  <span className="office-recent-message">{latestNote.message}</span>
                </>
              ) : (
                <span className="office-recent-message">
                  {state.version > 0 && state.runMessage
                    ? state.runMessage
                    : "원하는 장비와 예산을 상담 직원에게 알려 주세요."}
                </span>
              )}
            </p>
          </div>
        )}
      </div>
      {open && (
        <OfficeTeamDetail
          state={state}
          team={open}
          id={detailId}
          paused={paused}
          onClose={closeDetail}
          onSelectTeam={setOpen}
        />
      )}
    </section>
  );
}
