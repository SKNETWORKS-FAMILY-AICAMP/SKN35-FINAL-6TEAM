import { useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { WelcomeVisual } from "./WelcomeVisual";
import "./welcomeStage.css";

const TEAMS = [
  {
    key: "consultation",
    name: "상담팀",
    short: "먼저, 당신의 이야기",
    detail: "용도와 예산을 듣고, 필요한 조건을 함께 정리해요.",
    hair: "#4d4237",
    skin: "#e9c5a6",
    path: "M146 92H190Q213 92 230 114L275 170",
  },
  {
    key: "design",
    name: "설계·분석팀",
    short: "조건에 맞는 좋은 선택",
    detail: "기업의 상품과 판매 정책에서 조건에 맞는 구성을 찾아요.",
    hair: "#55504e",
    skin: "#e4bb9b",
    path: "M454 93H416Q392 93 376 115L336 174",
  },
  {
    key: "validation",
    name: "검증팀",
    short: "꼼꼼하게, 한 번 더",
    detail: "부품 간 호환성을 확인하고, 추가 확인이 필요한 점을 알려 드려요.",
    hair: "#394a48",
    skin: "#e4c4ad",
    path: "M146 270H196Q224 270 245 248L278 214",
  },
  {
    key: "quotation",
    name: "견적·주문팀",
    short: "한눈에 보는 나의 견적",
    detail: "선택한 부품과 가격을 견적서로 정리하고, 고객의 승인을 기다려요.",
    hair: "#574237",
    skin: "#edccaa",
    path: "M454 267H416Q392 267 373 246L338 214",
  },
] as const;

type TeamKey = (typeof TEAMS)[number]["key"];

function PixelFace({ team }: { team: (typeof TEAMS)[number] }) {
  return (
    <svg
      className="bw-stage-avatar"
      viewBox="0 0 24 24"
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      <path d="M6 4h12v2h2v11h-2v2H6v-2H4V6h2Z" fill={team.hair} />
      <path d="M6 9h12v8h-2v3H8v-3H6Z" fill={team.skin} />
      <path d="M5 8V5h14v5h-5V8Z" fill={team.hair} />
      <path d="M8 11h2v2H8Zm6 0h2v2h-2Z" fill="#293b35" />
      <path d="M10 16h4v1h-4Z" fill="#b7866c" />
      <path d="M7 19h10v2h3v3H4v-3h3Z" fill="currentColor" />
      <path d="m9 19 3 2 3-2v3H9Z" fill="#f9f8f1" />
      {team.key === "consultation" && (
        <path
          d="M3 8h2v7H3Zm16 0h2v7h-2ZM4 5h2v3H4Zm2-2h12v2H6Zm12 2h2v3h-2Zm-1 10h3v2h-7v-2Z"
          fill="#50685c"
        />
      )}
      {team.key === "design" && (
        <path d="M7 10h4v4H7Zm6 0h4v4h-4Zm-2 1h2v1h-2Z" fill="none" stroke="#6d6481" />
      )}
      {team.key === "quotation" && <path d="M19 5h3v12h-4v-5h1Z" fill={team.hair} />}
    </svg>
  );
}

/** 팀의 역할을 소개하는 장식 장면입니다. 실제 상담 진행이나 AgentEvent를 재현하지 않습니다. */
export function WelcomeStage() {
  const [selected, setSelected] = useState<TeamKey>("consultation");
  const [paused, setPaused] = useState(false);
  const stageRef = useRef<HTMLElement>(null);
  const current = TEAMS.find((team) => team.key === selected)!;
  function resetTilt() {
    stageRef.current?.style.setProperty("--bw-stage-rotate-x", "0deg");
    stageRef.current?.style.setProperty("--bw-stage-rotate-y", "0deg");
  }
  function tilt(event: PointerEvent<HTMLElement>) {
    if (
      paused ||
      event.pointerType !== "mouse" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !window.matchMedia("(min-width: 761px) and (hover: hover)").matches
    )
      return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width) * 2 - 1));
    const y = Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height) * 2 - 1));
    event.currentTarget.style.setProperty("--bw-stage-rotate-x", `${-y * 2}deg`);
    event.currentTarget.style.setProperty("--bw-stage-rotate-y", `${x * 2}deg`);
  }
  return (
    <section
      ref={stageRef}
      className="bw-welcome-stage"
      aria-label="AI 팀 업무 소개"
      data-motion={paused ? "paused" : "playing"}
      onPointerMove={tilt}
      onPointerLeave={resetTilt}
    >
      <div className="bw-stage-heading">
        <span>
          <i aria-hidden="true" />
          AI 직원 팀 · 업무 소개
        </span>
        <button
          type="button"
          className="bw-stage-pause"
          aria-pressed={paused}
          onClick={() => {
            setPaused(!paused);
            resetTilt();
          }}
        >
          <span aria-hidden="true">{paused ? "▷" : "Ⅱ"}</span>
          {paused ? "움직임 재생" : "움직임 멈춤"}
        </button>
      </div>
      <div className="bw-stage-canvas">
        <svg
          className="bw-stage-connections"
          viewBox="0 0 600 360"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <ellipse
            cx="302"
            cy="305"
            rx="210"
            ry="31"
            fill="none"
            stroke="#b9cbb9"
            strokeWidth=".7"
            strokeDasharray="3 7"
            opacity=".6"
          />
          {TEAMS.map((team) => (
            <g
              key={team.key}
              className={`bw-stage-connection${selected === team.key ? " is-selected" : ""}`}
            >
              <path d={team.path} className="bw-stage-connection-base" />
              <path d={team.path} className="bw-stage-connection-travel" />
            </g>
          ))}
        </svg>
        <div className="bw-stage-product">
          <WelcomeVisual frameless showCaption={false} />
        </div>
        {TEAMS.map((team, index) => (
          <button
            key={team.key}
            type="button"
            className={`bw-stage-team bw-stage-team-${team.key}`}
            aria-label={`${team.name} 업무 소개`}
            aria-pressed={selected === team.key}
            style={{ "--bw-stage-team-index": index } as CSSProperties}
            onClick={() => setSelected(team.key)}
          >
            <span className="bw-stage-face">
              <PixelFace team={team} />
            </span>
            <span className="bw-stage-team-copy">
              <strong>{team.name}</strong>
              <small>{team.short}</small>
            </span>
            <span className="bw-stage-card-corner" aria-hidden="true">
              ↗
            </span>
          </button>
        ))}
      </div>
      <div className={`bw-stage-description bw-stage-description-${selected}`} aria-live="polite">
        <span className="bw-stage-description-number" aria-hidden="true">
          0{TEAMS.indexOf(current) + 1}
        </span>
        <p>
          <strong>{current.name}</strong>
          <span>{current.detail}</span>
        </p>
        <span className="bw-stage-description-dots" aria-hidden="true">
          {TEAMS.map((team) => (
            <i key={team.key} className={selected === team.key ? "is-selected" : ""} />
          ))}
        </span>
      </div>
      <p className="bw-stage-caption">
        팀을 눌러 역할을 살펴보세요. 제품과 팀 연결은 예시 일러스트입니다.
      </p>
    </section>
  );
}
