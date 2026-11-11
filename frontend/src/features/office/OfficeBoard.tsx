/**
 * 2D 오피스 화면의 자리 — 지금은 상태 확인용 최소 화면입니다.
 * 캐릭터·애니메이션은 나중에 이 컴포넌트를 바꿔 끼우면 되고, 입력(OfficeState)은 그대로 씁니다.
 */
import { useState } from "react";
import type { Team } from "../../api/client";
import { STATUS_LABELS, TEAM_LABELS, TEAMS, type OfficeState } from "./officeState";

interface Props {
  state: OfficeState;
  onRetry?: () => void;
}

export function OfficeBoard({ state, onRetry }: Props) {
  const [open, setOpen] = useState<Team | null>(null);
  const canRetry = state.runStatus === "failed" && state.runError?.retryable && onRetry;

  return (
    <section className="panel" aria-label="AI 오피스">
      <header className="panel-head">
        <h2>AI 오피스</h2>
        <span className={`status status-${state.runStatus}`} data-testid="run-status">
          {state.version ? `요구사항 v${state.version} · ` : ""}
          {STATUS_LABELS[state.runStatus]}
        </span>
      </header>
      {state.runMessage && <p className="run-message">{state.runMessage}</p>}
      {state.runError && (
        <p className="error">
          {state.runError.code}: {state.runError.message}
          {canRetry && (
            <button type="button" onClick={onRetry}>
              다시 시도
            </button>
          )}
        </p>
      )}
      <div className="office-grid">
        {TEAMS.map((team) => {
          const teamState = state.teams[team];
          return (
            <button
              type="button"
              key={team}
              className={`desk status-${teamState.status}`}
              data-testid={`desk-${team}`}
              aria-expanded={open === team}
              onClick={() => setOpen(open === team ? null : team)}
            >
              <span className="desk-name">{TEAM_LABELS[team]}</span>
              <span className="desk-status">{STATUS_LABELS[teamState.status]}</span>
              <span className="desk-message">{teamState.message || "—"}</span>
            </button>
          );
        })}
      </div>
      {open && (
        <ol className="desk-log" aria-label={`${TEAM_LABELS[open]} 작업 기록`}>
          {state.teams[open].log.length === 0 && <li>아직 기록이 없습니다.</li>}
          {state.teams[open].log.map((event) => (
            <li key={event.seq}>
              <span className="mono">#{event.seq}</span> {STATUS_LABELS[event.status]} ·{" "}
              {event.message}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
