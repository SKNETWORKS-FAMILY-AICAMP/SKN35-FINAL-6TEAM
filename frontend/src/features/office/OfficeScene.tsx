import {
  useEffect,
  useId,
  useMemo,
  useReducer,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import type { Team } from "../../api/client";
import {
  handoff,
  printOut,
  runStopped,
  signalKind,
  teamHalted,
  validators,
  type Handoff,
  type SignalKind,
} from "./officeCues";
import { deliveryVisualReducer, initialDeliveryVisual } from "./officeDelivery";
import { TEAM_LABELS, TEAMS, type DisplayStatus, type OfficeState } from "./officeState";

// Original daylight pixel office. All furniture, wood grain and sunlight use this integer grid.
// New details are drawn on a 3-unit grid (3 SVG units = one art pixel).
const ROOMS = [
  {
    x: 24,
    y: 24,
    floor: "#f0e5d1",
    rug: "#ddc8a6",
    accent: "#98713e",
    shirt: "#d1a46c",
    hair: "#342d31",
  },
  {
    x: 500,
    y: 24,
    floor: "#eae6ef",
    rug: "#d2c9e0",
    accent: "#75629e",
    shirt: "#a99ad2",
    hair: "#57463e",
  },
  {
    x: 24,
    y: 332,
    floor: "#e4edf0",
    rug: "#c5dce0",
    accent: "#487d94",
    shirt: "#72b5c9",
    hair: "#283444",
  },
  {
    x: 500,
    y: 332,
    floor: "#e8eddf",
    rug: "#c8dac1",
    accent: "#4a8267",
    shirt: "#83b99c",
    hair: "#4c3930",
  },
];

// 말풍선·책상 램프 색. 방 칩의 상태 토큰(--st-*)과 같은 값입니다.
const SIGNAL: Record<SignalKind, string> = {
  none: "#8d978a",
  working: "#1f63c6",
  retrying: "#1f63c6",
  done: "#1d6b3f",
  attention: "#a35c00",
  revision: "#7a4a00",
  failed: "#c0362c",
  stopped: "#56625b",
};

const AWAY: DisplayStatus[] = ["idle", "pending", "cancelled", "superseded"];
const AT_DESK = { x: 216, y: 143 };
const AT_SIDE = { x: 111, y: 154 };
// 검증팀 책상의 남는 두 자리. 가운데 자리는 방의 원래 직원이 앉습니다.
const EXTRA_SEATS = [
  { x: 165, hair: "#57463e", variant: 1 },
  { x: 267, hair: "#4c3930", variant: 3 },
];
// 서류 봉투가 놓이는 책상 위 지점(방 기준)과 복도 한가운데 높이(지도 기준).
const DESK_DROP = { x: 216, y: 114 };
const HALL_Y = 298;

type Led = "off" | "on" | "done" | "alert";

/** Pixel rectangle with one stepped notch on each corner. */
function notched(x: number, y: number, w: number, h: number, n: number): string {
  return `M${x + n} ${y}h${w - 2 * n}v${n}h${n}v${h - 2 * n}h${-n}v${n}h${-(w - 2 * n)}v${-n}h${-n}v${-(h - 2 * n)}h${n}Z`;
}

function PixelPerson({ shirt, hair, variant }: { shirt: string; hair: string; variant: number }) {
  const skin = ["#e6b794", "#c79879", "#eac6a7", "#d2a084"][variant];
  return (
    <g className="office-person">
      <path d="M-15 31h30v3h6v6h-36v-3h-6v-3h6Z" fill="#83917d" opacity=".55" />
      <g className="office-person-body loop">
        <path d="M-9-3H9v3h3v15H9v6H-9v-6h-3V0h3Z" fill="#101923" />
        <path d="M-9-3H9v3h3v12H-12V0h3Z" fill={hair} />
        {variant === 3 && <path d="M9 3h6v6h3v12h-6V12H9Z" fill={hair} />}
        <path d="M-9 6H9v9H6v6H-6v-6h-3Z" fill={skin} />
        <path d="M-9 0H9v6H3V3H-9Z" fill={hair} />
        <path d="M-6 0H3v3H-6Z" fill="#d1b29c" opacity=".3" />
        <path d="M-12 9h3v6h-3Zm21 0h3v6H9Z" fill={skin} />
        <path d="M6 9h3v6H6Zm-12 6H6v3H-6Z" fill="#9d6f58" opacity=".35" />
        <path d="M-6 10h3v3h-3Zm9 0h3v3H3Z" fill="#25303c" />
        <path d="M-3 16h6v2h-6Z" fill="#ad7961" />
        <path d="M-9 21H9v3h3v9H-12v-9h3Z" fill={shirt} />
        <path d="M-12 24h3v9h-3Zm21 0h3v9H9ZM-9 30H9v3H-9Z" fill="#142336" opacity=".3" />
        <path d="M-6 21H0v3H-6Zm9 0H9v3H3Z" fill="#f1e7d4" opacity=".8" />
        <path d="M0 24h2v6H0Z" fill="#223244" opacity=".4" />
        <path d="M4 25h4v5H4Z" fill="#e5e6db" />
        <path d="M5 26h2v1H5Z" fill="#617483" />
        <path className="office-person-hands loop" d="M-15 24h6v6h-6Zm24 0h6v6H9Z" fill={skin} />
        <path d="M-9 33h6v3h-9v-3Zm12 0h6v3h3v3H3Z" fill="#3b485a" />
        <path d="M-12 36h9v3h-9Zm15 0h9v3H3Z" fill="#152233" />
        <path d="M-12 38h9v1h-9Zm15 0h9v1H3Z" fill="#6f7c88" />
        {variant === 0 && (
          <g>
            <path
              d="M-15 3h3v12h-3Zm0-3h3v3h-3Zm3-3H9v3h-21Zm21 3h3v3H9Zm3 3h3v12h-3Zm0 12h3v3H3v-3Z"
              fill="#283b4c"
            />
            <path d="M-15 6h2v6h-2Zm28 0h2v6h-2ZM3 15h4v3H3Z" fill="#9eb5b8" />
          </g>
        )}
        {variant === 1 && (
          <path
            d="M-9 9h9v6h-9Zm12 0h9v6H3ZM0 10h3v2H0Z"
            fill="none"
            stroke="#3d425c"
            strokeWidth="1"
          />
        )}
        {variant === 2 && <path d="M-9 0H6v3H0v3H-9Z" fill="#1c3042" />}
      </g>
    </g>
  );
}

function TeamFurniture({ index, rack, printer }: { index: number; rack: Led[]; printer: Led }) {
  if (index === 0)
    return (
      <g>
        <path d="M321 143h90v45h-90Z" fill="#87917a" opacity=".5" />
        <path d="M324 129h78v48h-78Z" fill="#a0825e" />
        <path d="M327 126h72v15h-72Z" fill="#d4ba8a" />
        <path d="M330 129h66v3h-66Z" fill="#e8d2a6" />
        <path d="M330 141h30v27h-30Zm36 0h30v27h-30Z" fill="#c6b28c" />
        <path d="M330 141h30v3h-30Zm36 0h30v3h-30Z" fill="#e3d0a9" />
        <path d="M330 165h30v3h-30Zm36 0h30v3h-30Z" fill="#ad936c" />
        <path d="M321 132h9v39h-9Zm75 0h9v39h-9Z" fill="#d8c298" />
        <path d="M324 132h3v36h-3Zm75 0h3v36h-3Z" fill="#eee0ba" />
        <path d="M327 174h6v9h-6Zm66 0h6v9h-6Z" fill="#7f8170" />
        <path d="M336 144h15v15h-15Z" fill="#eee1bb" />
        <path d="M339 147h9v9h-9Z" fill="#fff2d3" />
        <path d="M381 144h12v18h-12Z" fill="#9fb6ae" />
        <path d="M381 147h12v2h-12m0 4h12" stroke="#cad6bd" strokeWidth="1" />
        <path d="M72 144h42v24H72Z" fill="#8b927c" opacity=".5" />
        <path d="M72 139h39v27H72Z" fill="#b99d73" />
        <path d="M69 136h42v24H69Z" fill="#e2c69d" />
        <path d="M72 139h36v3H72Z" fill="#f4dfb8" />
        <path d="M78 144h15v12H78Z" fill="#fff4da" />
        <path d="M81 147h9m-9 3h6" stroke="#777f7c" strokeWidth="1" />
        <path d="M96 142h9v9h-9Zm9 3h3v3h-3Z" fill="#709d8a" />
        <path d="M98 143h5v2h-5Z" fill="#b6c4b6" />
      </g>
    );
  if (index === 1)
    return (
      <g>
        <path d="M330 140h78v48h-78Z" fill="#8b879b" opacity=".55" />
        <path d="M333 153h6v30h-6Zm60 0h6v30h-6Z" fill="#9992a2" />
        <path d="M324 126h81v48h-81Z" fill="#b6a78c" />
        <path d="M327 123h75v42h-75Z" fill="#eee7d9" />
        <path d="M327 123h75v3h-75Z" fill="#fff8e9" />
        <path d="M336 129h45v30h-45Z" fill="#9ba8bf" />
        <path
          d="M339 132h15v9h-15Zm0 15h15v9h-15Zm24-9h12v12h-12ZM354 136h6v14h-6m0-6h3"
          fill="none"
          stroke="#f4eff6"
          strokeWidth="2"
        />
        <path d="M387 129h6v30h-6Z" fill="#b49c6b" />
        <path d="M387 135h3m-3 6h3m-3 6h3m-3 6h3" stroke="#6d654f" strokeWidth="1" />
        <path d="M396 132h3v24h-3Z" fill="#6f6a9a" />
        <path d="M63 135h48v15H63Z" fill="#a396b9" />
        <path d="M66 132h42v15H66Z" fill="#c8bad8" />
        <path d="M69 132h6v15h-6m6-9h24" stroke="#eee4ef" strokeWidth="2" />
        <path d="M75 156h15v12H75Z" fill="#f2ebe3" />
        <path d="M78 159h9v3h-9Z" fill="#a596b6" />
        <path d="M99 154h12v18H99Z" fill="#8a829b" />
        <path d="M102 157h6v9h-6Z" fill="#d4cae2" />
      </g>
    );
  if (index === 2)
    return (
      <g>
        <rect x="333" y="125" width="69" height="66" fill="#7f9597" opacity=".6" />
        <rect x="330" y="117" width="66" height="69" fill="#8ba5a3" />
        <path d="M330 117h66v3h-66Zm0 0h3v69h-3Z" fill="#c6d8cd" />
        <path d="M393 120h3v66h-3Z" fill="#66847f" />
        {[0, 1, 2].map((n) => (
          <g key={n}>
            <rect x="336" y={123 + n * 18} width="54" height="15" fill="#142331" />
            <path d={`M336 ${123 + n * 18}h54v2h-54Z`} fill="#64858d" />
            <rect
              className={`office-led led-${rack[n]} loop`}
              x="339"
              y={126 + n * 18}
              width="3"
              height="3"
            />
            <path d={`M345 ${126 + n * 18}h3v3h-3Z`} fill="#71a6ab" />
            <path d={`M357 ${127 + n * 18}h24v2h-24Zm0 4h24v2h-24Z`} fill="#4f6d7e" />
            <path d={`M384 ${127 + n * 18}h2v5h-2Z`} fill="#263f50" />
          </g>
        ))}
        <path d="M336 183h6v6h-6Zm48 0h6v6h-6Z" fill="#607b75" />
        <path d="M57 139h57v30H57Z" fill="#7c9092" opacity=".5" />
        <path d="M57 136h54v30H57Z" fill="#a7b9ad" />
        <path d="M60 133h48v27H60Z" fill="#e8ecdf" />
        <path d="M60 133h48v3H60Z" fill="#fbf7e8" />
        <path d="M66 139h21v15H66Z" fill="#2a5363" />
        <path d="M69 142h15v9H69Z" fill="#527b85" />
        <path d="M69 147h3v-3h3v5h3v-4h6" fill="none" stroke="#a6d8d1" strokeWidth="1" />
        <path d="M93 139h6v6h-6Zm0 9h6v6h-6Z" fill="#b8c6ad" />
        <path d="M66 160v12h15" fill="none" stroke="#71949b" strokeWidth="2" />
        <path d="M81 169h9v6h-9Z" fill="#344c59" />
      </g>
    );
  return (
    <g>
      <path d="M327 162h81v27h-81Z" fill="#849784" opacity=".55" />
      <path d="M327 156h81v6h-81Zm6 6h6v24h-6Zm63 0h6v24h-6Z" fill="#b79c70" />
      <path d="M327 156h81v2h-81Z" fill="#d6c199" />
      <rect x="330" y="129" width="39" height="30" fill="#ba9568" />
      <path d="M330 126h39v24h-39Z" fill="#e0bf88" />
      <path d="M330 126h39v3h-39ZM345 126h9v24h-9Z" fill="#f4e0b1" />
      <path d="M354 135h9v9h-9Z" fill="#fff4d4" />
      <path d="M356 137h5v1h-5m0 2h4" stroke="#7c806d" strokeWidth="1" />
      <rect x="372" y="138" width="36" height="24" fill="#b28f63" />
      <path d="M372 135h33v21h-33Z" fill="#dec08d" />
      <path d="M384 135h6v21h-6Z" fill="#f5e0b3" />
      <path d="M396 141h6v9h-6Z" fill="#fff0cd" />
      <path d="M60 148h51v24H60Z" fill="#859782" opacity=".55" />
      <path d="M60 144h48v24H60Z" fill="#8aa898" />
      <path d="M63 135h42v21H63Z" fill="#d6e0cb" />
      <path d="M63 135h42v3H63Z" fill="#f1f1dd" />
      <path d="M69 129h30v18H69Z" fill="#fff9e7" />
      <path d="M75 135h18m-18 5h12" stroke="#8d9a8a" strokeWidth="2" />
      <path d="M66 153h36v9H66Z" fill="#263f41" />
      <path d="M75 156h21v15H75Z" fill="#f3efd8" />
      <path d="M78 163h15m-15 4h9" stroke="#899c86" strokeWidth="1" />
      <rect className={`office-led led-${printer} loop`} x="96" y="147" width="6" height="3" />
    </g>
  );
}

/** Monitor face drawn over the desk. Colours come from the room's status variables. */
function Screen() {
  return (
    <g className="office-screen" transform="translate(187 71)">
      <rect className="office-screen-face" width="58" height="29" />
      <rect className="office-screen-bar" width="58" height="5" />
      <g className="office-screen-content">
        <path d="M3 1h3v3H3Zm5 0h3v3H8Zm5 0h3v3h-3Z" fill="#cfe3ff" opacity=".8" />
        <rect x="3" y="8" width="12" height="18" fill="#0d2440" opacity=".25" />
        <path
          className="office-screen-frame-a loop"
          d="M18 8h27v3H18Zm0 6h33v3H18Zm0 6h21v3H18Z"
          fill="#cfe3ff"
        />
        <path
          className="office-screen-frame-b loop"
          d="M18 8h33v3H18Zm0 6h21v3H18Zm0 6h30v3H18Z"
          fill="#cfe3ff"
        />
      </g>
      <g className="office-screen-check">
        <path
          d="M18 12h3v6h-3ZM21 15h3v6h-3ZM24 18h3v6h-3ZM27 15h3v6h-3ZM30 12h3v6h-3ZM33 9h3v6h-3ZM36 6h3v6h-3Z"
          fill="#c9f5d8"
        />
        <path className="office-screen-cursor loop" d="M45 21h6v3h-6Z" fill="#c9f5d8" />
      </g>
      <path className="office-screen-alert" d="M26 6h6v12h-6Zm0 15h6v3h-6Z" fill="#ffd9d4" />
    </g>
  );
}

function SignalBubble({ kind }: { kind: SignalKind }) {
  const color = SIGNAL[kind];
  if (kind === "attention") {
    const outer = "M-18-51H18V-12H9V-3H-9V-12H-18Z";
    return (
      <g className="office-signal-body loop">
        <path d={outer} fill="#4f5d4a" opacity=".25" transform="translate(3 3)" />
        <path d={outer} fill={color} />
        <path d="M-12-45H12V-18H3V-9H-3V-18H-12Z" fill="#fff3dc" />
        <path
          d="M-6-42h12v3h-12ZM-9-39h6v3h-6ZM3-39h6v6H3ZM0-33h6v3H0ZM-3-30h6v3h-6ZM-3-24h6v3h-6Z"
          fill={color}
        />
      </g>
    );
  }
  const outer = "M-18-36H18V-9H6V-3H-6V-9H-18Z";
  return (
    <g className="office-signal-body loop">
      <path d={outer} fill="#4f5d4a" opacity=".25" transform="translate(3 3)" />
      <path d={outer} fill={color} />
      <path d="M-15-33H15V-12H3V-6H-3V-12H-15Z" fill="#fffdf0" />
      {kind === "working" && <path d="M-12-27h6v6h-6Zm9 0h6v6h-6Zm9 0h6v6h-6Z" fill={color} />}
      {kind === "retrying" && (
        <path
          className="office-signal-spin loop"
          d="M-6-30h9v3h-9ZM-9-27h3v12h-3ZM3-27h3v3H3ZM0-24h9v3H0ZM3-21h3v3H3ZM-6-15h12v3h-12Z"
          fill={color}
        />
      )}
      {kind === "done" && (
        <path
          d="M6-30h6v3H6ZM3-27h6v3H3ZM-12-24h6v3h-6ZM0-24h6v3H0ZM-9-21h12v3H-9ZM-6-18h6v3h-6Z"
          fill={color}
        />
      )}
      {kind === "failed" && <path d="M-3-30h6v9h-6Zm0 12h6v3h-6Z" fill={color} />}
      {kind === "stopped" && <path d="M-9-24h18v3h-18Z" fill={color} />}
      {kind === "revision" && (
        <g>
          <path d="M-3-30h12v15h-12Z" fill="#d9b06a" />
          <path d="M-9-27h12v15h-12Z" fill="#f3e3c2" />
          <path d="M-6-24h6v3h-6Zm0 6h6v3h-6Z" fill={color} />
        </g>
      )}
    </g>
  );
}

/** A folder carried from one team's desk, down the corridor, to the next team's desk. */
function Envelope({ cue, carried = false }: { cue: Handoff; carried?: boolean }) {
  const from = ROOMS[TEAMS.indexOf(cue.from)];
  const to = ROOMS[TEAMS.indexOf(cue.to)];
  const toX = to.x + DESK_DROP.x;
  const toY = to.y + DESK_DROP.y;
  // The resting position is the destination; the keyframes start from the sender's desk.
  // With reduced motion the animation is off and the folder simply sits on the new desk.
  const route = {
    "--from-x": `${from.x + DESK_DROP.x}px`,
    "--from-y": `${from.y + DESK_DROP.y}px`,
    "--hall-y": `${HALL_Y}px`,
    "--to-x": `${toX}px`,
    "--to-y": `${toY}px`,
  } as CSSProperties;
  return (
    <g className="office-transfer" style={route} data-carried={carried || undefined}>
      <path
        className="office-transfer-path"
        d={`M${from.x + DESK_DROP.x} ${from.y + DESK_DROP.y}V${HALL_Y}H${toX}V${toY}`}
        fill="none"
        stroke="#347967"
        strokeWidth="3"
        strokeDasharray="6 8"
      />
      <g className="office-cue-envelope" transform={`translate(${toX} ${toY})`}>
        <path d="M-6 6h18v3h-18Z" fill="#4f5d4a" opacity=".3" />
        <path d="M-6-9h12v3h-12Z" fill="#fffaf0" />
        <path d="M-9-6h18v12h-18Z" fill="#e9c37d" />
        <path d="M-9-6h18v3h-18Z" fill="#c99a4b" />
        <path d="M-3-3h6v3h-6Z" fill="#8c6a32" />
      </g>
    </g>
  );
}

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function reducedMotionSnapshot() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** 실제 인계가 생겼을 때만 서류를 든 직원이 복도를 달립니다. 도착은 업무 완료와 무관합니다. */
function DeliveryRunner({ cue, onArrived }: { cue: Handoff; onArrived: () => void }) {
  const index = TEAMS.indexOf(cue.from);
  const from = ROOMS[index];
  const to = ROOMS[TEAMS.indexOf(cue.to)];
  const direction = to.x >= from.x ? 1 : -1;
  const route = {
    "--runner-from-x": `${from.x + AT_DESK.x}px`,
    "--runner-from-y": `${from.y + AT_DESK.y}px`,
    "--runner-hall-y": `${HALL_Y - 20}px`,
    "--runner-to-x": `${to.x + AT_DESK.x}px`,
    "--runner-to-y": `${to.y + AT_DESK.y}px`,
    "--runner-direction": direction,
  } as CSSProperties;
  return (
    <g
      className="office-delivery"
      data-delivery-seq={cue.seq}
      data-from={cue.from}
      data-to={cue.to}
    >
      <path
        className="office-delivery-route loop"
        d={`M${from.x + AT_DESK.x} ${from.y + AT_DESK.y + 33}V${HALL_Y + 13}H${to.x + AT_DESK.x}V${to.y + AT_DESK.y + 33}`}
        fill="none"
        stroke={from.accent}
        strokeWidth="4"
        strokeDasharray="4 10"
      />
      <g
        className="office-delivery-runner loop"
        style={route}
        onAnimationEnd={(event) => {
          if (event.animationName === "office-run-delivery" && event.target === event.currentTarget)
            onArrived();
        }}
      >
        <ellipse cx="0" cy="41" rx="23" ry="6" fill="#314e3b" opacity=".15" />
        <g className="office-delivery-sprite loop">
          <PixelPerson shirt={from.shirt} hair={from.hair} variant={index} />
          <path className="office-running-leg-a loop" d="M-11 31h9v12h-12v-5h3Z" fill="#344552" />
          <path className="office-running-leg-b loop" d="M3 31h9v7h3v5H3Z" fill="#344552" />
          <g className="office-carried-folder" transform="translate(9 16)">
            <path d="M0-3h10v3h10v20H0Z" fill="#f0bf72" stroke="#836037" strokeWidth="1" />
            <path d="M3 2h14v13H3Z" fill="#fff8e3" />
            <path d="M5 6h10v2H5Zm0 4h7v2H5Z" fill="#a3a78d" />
          </g>
        </g>
        <g className="office-runner-caption" transform="translate(0 -25)">
          <rect x="-73" y="-10" width="146" height="19" rx="4" fill="#ffffff" stroke="#d9e2cf" />
          <text textAnchor="middle" y="3" fontSize="10" fill="#3b5646">
            {TEAM_LABELS[cue.from]} → {TEAM_LABELS[cue.to]}
          </text>
        </g>
        <path className="office-runner-dust loop" d="M-27 35h5v3h-5Zm-9 4h4v3h-4Z" fill="#b6bfa3" />
      </g>
    </g>
  );
}

export function OfficeScene({
  state,
  previewTeam = null,
  focusTeam = null,
}: {
  state: OfficeState;
  previewTeam?: Team | null;
  /** 상세 작업실은 한 방을 보여 주고, 실제 업무 정보는 HTML 모니터에 함께 표시합니다. */
  focusTeam?: Team | null;
}) {
  const prefix = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const ref = (name: string) => `#${prefix}-${name}`;
  const crew = validators(state);
  const pass = useMemo(() => handoff(state), [state]);
  const printed = printOut(state);
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    reducedMotionSnapshot,
    () => false,
  );
  const deliveryScope = `${state.version}:${state.runEvent?.run_id ?? "waiting"}`;
  const stopped = runStopped(state);
  const [delivery, updateDelivery] = useReducer(deliveryVisualReducer, undefined, () =>
    initialDeliveryVisual(deliveryScope, stopped || reducedMotion ? null : pass),
  );
  useEffect(() => {
    updateDelivery({
      type: "observe",
      scope: deliveryScope,
      cue: pass,
      stopped,
      reduced: reducedMotion,
    });
  }, [deliveryScope, pass, stopped, reducedMotion]);
  const currentDelivery =
    !stopped && !reducedMotion && delivery.scope === deliveryScope ? delivery.current : null;
  // Paint the enlarged room last so its furniture stays above the other rooms.
  // One-off cues live in the separate layer below, whose order never changes, so hovering
  // a room never remounts (and replays) them.
  const paintedTeams = focusTeam
    ? [focusTeam]
    : previewTeam
      ? [...TEAMS.filter((team) => team !== previewTeam), previewTeam]
      : TEAMS;

  function roomClass(team: Team) {
    const { status } = state.teams[team];
    return `office-art-room-${team} status-${status}${teamHalted(state, team) ? " is-halted" : ""}`;
  }

  function preview(team: Team) {
    return previewTeam === team ? "active" : previewTeam ? "dim" : undefined;
  }

  return (
    <svg
      className={`office-art${focusTeam ? " office-art-focused" : ""}`}
      viewBox={
        focusTeam
          ? `${ROOMS[TEAMS.indexOf(focusTeam)].x} ${ROOMS[TEAMS.indexOf(focusTeam)].y + 52} 436 154`
          : "0 0 960 600"
      }
      aria-hidden="true"
      focusable="false"
      shapeRendering="crispEdges"
    >
      <defs>
        <linearGradient id={`${prefix}-site`} x2="0" y2="1">
          <stop stopColor="#f7f5eb" />
          <stop offset="1" stopColor="#e8e5d7" />
        </linearGradient>
        <linearGradient id={`${prefix}-daylight`} x2="0" y2="1">
          <stop stopColor="#b9dce6" />
          <stop offset="1" stopColor="#e0edf0" />
        </linearGradient>
        <linearGradient id={`${prefix}-desk-top`} x2="0" y2="1">
          <stop stopColor="#ecd4ad" />
          <stop offset="1" stopColor="#d5b88b" />
        </linearGradient>
        <linearGradient id={`${prefix}-sunlight`} x1="1" y1="0" x2="0" y2="1">
          <stop stopColor="#fffbe3" stopOpacity=".7" />
          <stop offset="1" stopColor="#fffbe3" stopOpacity="0" />
        </linearGradient>
        {ROOMS.map((room, index) => (
          <radialGradient key={index} id={`${prefix}-room-light-${index}`}>
            <stop stopColor={room.accent} stopOpacity=".06" />
            <stop offset="1" stopColor={room.accent} stopOpacity="0" />
          </radialGradient>
        ))}
        <clipPath id={`${prefix}-print-clip`}>
          <rect x="60" y="159" width="51" height="36" />
        </clipPath>
        <pattern id={`${prefix}-floor`} width="48" height="24" patternUnits="userSpaceOnUse">
          <rect width="48" height="24" fill="#e8d9ba" />
          <path d="M0 23H48M47 0V24M23 0V3" stroke="#c2b395" strokeWidth="1" opacity=".5" />
          <path d="M3 3h27m5 15h9M6 18h18M31 7h10" stroke="#fff5dc" strokeWidth="1" opacity=".7" />
          <path d="M7 9h13m-9 3h16m8 6h5" stroke="#cbb896" strokeWidth="1" opacity=".28" />
        </pattern>
        <pattern id={`${prefix}-tile`} width="48" height="24" patternUnits="userSpaceOnUse">
          <path d="M0 23H48M47 0V24" fill="none" stroke="#9ea892" strokeOpacity=".16" />
          <path d="M3 2h39M3 3v17" fill="none" stroke="#fffdf0" strokeOpacity=".5" />
        </pattern>
        <pattern id={`${prefix}-weave`} width="9" height="9" patternUnits="userSpaceOnUse">
          <path d="M1 2h3v1H1Zm4 4h3v1H5Z" fill="#fffaf0" opacity=".12" />
        </pattern>
        <g id={`${prefix}-plant`}>
          <path d="M-12 21h30v6h-30Z" fill="#8a9477" opacity=".5" />
          <path d="M-9 6H9v6H6v12H-6V12H-9Z" fill="#b28662" />
          <path d="M-9 6H9v3H-9ZM-6 12h6v9h-6Z" fill="#d7af80" />
          <path d="M-3-15H0V9h-3Zm3 3H3V6H0Z" fill="#426e49" />
          <path d="M-18-9h9v3h6v12h-6V3h-6V0h-3ZM3-18h9v3h6v9H12v6H3Z" fill="#5b8d5c" />
          <path d="M-15-9h6v3h6v3h-9v-3h-3ZM6-15h6v9H6Z" fill="#a7be85" />
          <path d="M0-21H6v6H3v9H0Z" fill="#80a469" />
          <path d="M-15-9h3v3h-3ZM6-15h3v3H6Z" fill="#d1daa6" opacity=".6" />
        </g>
        <g id={`${prefix}-window`}>
          <rect x="3" y="6" width="78" height="45" fill="#869483" opacity=".18" />
          <rect width="78" height="42" fill="#9fb7b0" />
          <rect x="3" y="3" width="72" height="36" fill={`url(${ref("daylight")})`} />
          <path d="M9 9h6V6h9v3h6v5H9Zm36-1h6V5h9v3h9v5H45Z" fill="#f8fcf5" />
          <path d="M12 14h15v2H12Zm36-1h18v2H48Z" fill="#eef6ef" opacity=".8" />
          <path d="M6 27h6V15h9v6h6v-9h9v21H6Zm36-6h9v-9h9v6h6V9h6v24H42Z" fill="#b2c8c9" />
          <path d="M6 30h12v-6h9v3h9v9H6Zm36-3h9v-6h9v9h12v6H42Z" fill="#8cae9b" />
          <path
            d="M15 18h2v2h-2Zm0 6h2v2h-2Zm15-9h2v2h-2Zm0 6h2v2h-2Zm24-6h2v2h-2Zm12 0h2v2h-2Zm0 9h2v2h-2Z"
            fill="#eaf0de"
            opacity=".9"
          />
          <path d="M36 3h6v36h-6ZM3 33h72v6H3Z" fill="#d4e1d5" />
          <path d="M36 3h2v30h-2ZM3 33h72v2H3Z" fill="#f3f4e4" />
          <path d="M6 5h10L6 15Zm37 0h8l-8 8Z" fill="#ffffff" opacity=".45" />
          <path d="M0 39h81v6H0Z" fill="#a5b29f" />
          <path d="M0 39h78v3H0Z" fill="#e6dfc2" />
        </g>
        <g id={`${prefix}-tiny-plant`}>
          <path d="M-6 0H6v9H-6Z" fill="#d4ba93" />
          <path d="M-6 0H6v3H-6Z" fill="#f3e3c0" />
          <path d="M-3-12H3V0H-3ZM-9-9h6v6h-6Zm12-6h6v6H3Z" fill="#6e945f" />
          <path d="M-3-12H0V0H-3Z" fill="#a9c085" />
        </g>
        <g id={`${prefix}-chair`}>
          <path d="M-3 21h6v15H-3Zm-12 12h24v3h-24Z" fill="#839c90" />
          <path d="M-15 30h6v6h-6Zm24 0h6v6H9Z" fill="#b9c5b1" />
          <path d="M-15-6h30v27h-3v6h-24v-6h-3Z" fill="#6c8b7c" />
          <path d="M-12-6h24v18h-24Zm0 21h24v3h-24Z" fill="#9db6a1" />
          <path d="M-9-3H9V0H-9Z" fill="#d0d8b8" />
          <path d="M-9 3H9m-18 4H9" stroke="#7d9b87" strokeWidth="1" />
          <path d="M-18 3h6v18h-6Zm30 0h6v18h-6Z" fill="#5c7e6e" />
          <path d="M-18 3h6v3h-6Zm30 0h6v3h-6Z" fill="#aec5ad" />
        </g>
        <g id={`${prefix}-desk`}>
          <path d="M6 12h141v54H6Z" fill="#869483" opacity=".55" />
          <path d="M3 42h9v21H3Zm120 0h12v21h-12Z" fill="#99825e" />
          <path d="M6 45h3v18H6Zm120 0h3v18h-3Z" fill="#c2ac80" />
          <rect width="138" height="51" fill="#b4996e" />
          <rect x="3" y="3" width="132" height="42" fill={`url(${ref("desk-top")})`} />
          <path d="M3 3h132v3H3ZM3 42h132v3H3Z" fill="#fff0c8" opacity=".7" />
          <path d="M6 15h21m87 18h15M6 36h24" stroke="#bf9f72" strokeWidth="1" opacity=".3" />
          <path d="M33 24h78v18H33Z" fill="#9bb6aa" />
          <path d="M36 26h72v13H36Z" fill="#b9cabc" />
          {/* Monitor bezel only: the screen face is drawn per room by <Screen />. */}
          <path d="M39-17h60v3h3v36H36v-36h3Z" fill="#132330" />
          <path d="M39-17h60v2H39Zm-3 3h2v33h-2Z" fill="#7e9794" />
          <path d="M63 22h12v6h9v3H54v-3h9Z" fill="#253946" />
          <path d="M54 29h30v2H54Z" fill="#4b5e67" />
          <path d="M42 33h45v9H42Z" fill="#a1b3a0" />
          <path d="M42 32h45v7H42Z" fill="#f4f1dc" />
          <path
            d="M45 33h39m-39 3h39M48 33v5m6-5v5m6-5v5m6-5v5m6-5v5m6-5v5"
            stroke="#6f8586"
            strokeWidth="1"
          />
          <path d="M96 30h9v12h-9Z" fill="#8ba698" />
          <path d="M98 30h5v8h-5Z" fill="#f4f1dc" />
          <path d="M100 31v2" stroke="#6a7f83" strokeWidth="1" />
          <path d="M12 12h18v24H12Z" fill="#b9a17b" />
          <path d="M9 9h18v24H9Z" fill="#fff4d9" />
          <path d="M12 15h12m-12 6h9m-9 6h12" stroke="#8b9a8a" strokeWidth="2" />
          <path d="M27 21h3v15h-3Z" fill="#485f5e" />
          <path d="M114 9h12v12h-12Zm12 3h3v6h-3Z" fill="#3a6262" />
          <path d="M117 9h6v3h-6Z" fill="#f0dfbb" />
          <path d="M115 24h12v2h-12Z" fill="#ae976d" opacity=".5" />
          <path d="M40 16h58l12 16H30Z" fill="currentColor" opacity=".06" />
        </g>
        <g id={`${prefix}-shelf`}>
          <rect x="3" y="8" width="69" height="51" fill="#8f977f" opacity=".5" />
          <rect width="66" height="51" fill="#b89c73" />
          <path d="M3 3h60v18H3Zm0 24h60v21H3Z" fill="#9d9b7e" />
          <path d="M0 0h66v3H0Zm0 21h66v3H0Zm0 24h3v27H0Zm63 0h3v27h-3Z" fill="#dfc59a" />
          <path d="M0 0h66v1H0Zm0 21h66v1H0Z" fill="#f7e7c0" />
          <path d="M6 6h6v15H6Zm9-3h9v18h-9Zm33 0h9v18h-9Z" fill="#b0c4a0" />
          <path d="M27 6h6v15h-6Zm9-3h9v18h-9Z" fill="#9db9c7" />
          <path d="M9 9h3v3H9Zm9-3h3v3h-3Zm12 3h3v3h-3Zm9-3h3v3h-3Zm12 0h3v3h-3Z" fill="#f8f0d4" />
          <path d="M6 30h21v15H6Z" fill="#d0b68b" />
          <path d="M9 30h15v3H9Zm3 6h9v3h-9Z" fill="#f5dfb8" />
          <path d="M33 39h24v6H33Z" fill="#96b7a5" />
          <path d="M36 33h21v6H36Z" fill="#d9bd92" />
          <path d="M33 30h21v3H33Z" fill="#bfb4d2" />
        </g>
        <g id={`${prefix}-lamp`}>
          <path d="M-9 55H9v3H-9Z" fill="#8c977c" opacity=".6" />
          <path d="M-6 51H6v3H-6ZM-1 9h3v42h-3Z" fill="#9c967a" />
          <path d="M0 9h1v42H0Z" fill="#d7c6a1" />
          <path d="M-9 0H9v3h3v12h-24V3h3Z" fill="#d6c59d" />
          <path d="M-6 0H6v12H-6Z" fill="#f7eccc" />
          <path d="M-12 12h24v3h-24Z" fill="#fff1c8" />
          <path d="M-9 15H9v2H-9Z" fill="#c5aa7d" />
        </g>
      </defs>
      <rect width="960" height="600" fill="#f0f3ea" />
      <path d="M12 12h936v576H12Z" fill={`url(${ref("site")})`} />
      <path d="M9 9h942v576H9Z" fill="none" stroke="#c1c8b7" strokeWidth="3" />
      <path d="M15 18h930v564H15Z" fill={`url(${ref("floor")})`} />
      <path d="M9 585h942v6H9Z" fill="#83917d" />
      <path d="M12 12h936v2H14v570h-2Z" fill="#fffef3" opacity=".4" />
      <path d="M468 18h24v69h-24Zm0 510h24v72h-24Z" fill="#b9c5b1" />
      <path d="M471 24h18v60h-18Zm0 492h18v87h-18Z" fill="none" stroke="#e0dec5" strokeWidth="2" />
      <path d="M474 30h12v2h-12Zm0 522h12v2h-12Z" fill="#b4c294" opacity=".5" />
      <use href={ref("plant")} x="480" y="54" />
      <use href={ref("plant")} x="480" y="543" />
      <path d="M24 276h912v3H24Zm0 42h912v3H24Z" fill="#d5d0b7" />
      <path d="M36 283h168v25H36Zm720 0h168v25H756Z" fill="#dfdec6" />
      <path d="M42 286h156v18H42Zm720 0h156v18H762Z" fill="none" stroke="#f6efd7" strokeWidth="1" />
      <path
        d="M60 294h102m630 0h102"
        stroke="#758674"
        strokeWidth="2"
        strokeDasharray="3 9"
        opacity=".65"
      />
      <path d="M186 289l7 5-7 5Zm582 0 7 5-7 5Z" fill="#9ca887" opacity=".65" />
      <path
        d="M235 287h18v3h-18Zm471 0h18v3h-18ZM235 303h18v3h-18Zm471 0h18v3h-18Z"
        fill="#d8cfaa"
        opacity=".4"
      />
      <path d="M462 280h36v35h-36Z" fill="#d4d5b9" />
      <path d="M471 289h18v17h-18Z" fill="none" stroke="#f5efd5" strokeWidth="1" />
      <path d="M477 295h6v5h-6Z" fill="#a8bc83" opacity=".65" />
      {paintedTeams.map((team) => {
        const index = TEAMS.indexOf(team);
        const room = ROOMS[index];
        const { status } = state.teams[team];
        const kind = signalKind(state, team);
        const atDesk = !AWAY.includes(status);
        const topRow = index < 2;
        const rack: Led[] = [0, 1, 2].map((n) =>
          n < crew.count
            ? "on"
            : status === "completed"
              ? "done"
              : status === "failed"
                ? "alert"
                : "off",
        );
        const printer: Led =
          status === "running"
            ? "on"
            : status === "completed"
              ? "done"
              : status === "failed"
                ? "alert"
                : "off";
        return (
          <g
            key={team}
            transform={`translate(${room.x} ${room.y})`}
            className={`office-art-room ${roomClass(team)}`}
            data-preview={preview(team)}
            style={{ color: room.accent }}
          >
            <g className="office-art-room-zoom">
              <g className="office-art-room-body">
                <rect x="3" y="9" width="436" height="237" fill="#9ba48c" opacity=".3" />
                <rect width="436" height="240" fill="#f8f7ee" />
                <rect x="12" y="60" width="412" height="135" fill={room.floor} />
                <rect x="12" y="60" width="412" height="135" fill={`url(${ref("tile")})`} />
                <path d="M12 60h412v9H21v126h-9Z" fill="#8f977f" opacity=".15" />
                <path d="M0 0H436V6H6V234h430v6H0Z" fill="#bec8b4" />
                <path d="M6 6H430V12H12V234H6Z" fill="#fffdf2" />
                <path d="M0 0h436v2H2v232H0Z" fill="#ffffff" opacity=".3" />
                <path d="M430 6h6v228h-6Z" fill="#ccd4bf" />
                <path d="M12 12h418v45H12Z" fill="#fcfaf2" />
                <path d="M12 57h418v3H12Z" fill="#d4dcc7" />
                <path d="M15 58h123v1H15Z" fill={room.accent} opacity=".55" />
                <path d="M12 60h418v2H12Z" fill={room.accent} opacity=".09" />
                <rect x="130" y="73" width="174" height="124" fill="#98a18c" opacity=".18" />
                <rect x="135" y="75" width="165" height="120" fill={room.rug} />
                <rect x="135" y="75" width="165" height="120" fill={`url(${ref("weave")})`} />
                <rect
                  x="141"
                  y="81"
                  width="153"
                  height="108"
                  fill="none"
                  stroke={room.accent}
                  strokeOpacity=".2"
                  strokeWidth="2"
                />
                <path d="M144 192h147v3H144Z" fill="#83917d" opacity=".4" />
                {/* Work light: three stepped layers, shown once the room has received work. */}
                <g className="office-work-light loop" fill="#ffd66b">
                  <path d={notched(123, 72, 186, 123, 9)} opacity=".16" />
                  <path d={notched(141, 84, 150, 105, 9)} opacity=".18" />
                  <path d={notched(165, 102, 102, 81, 6)} opacity=".2" />
                </g>
                <ellipse
                  cx="220"
                  cy="110"
                  rx="100"
                  ry="65"
                  fill={`url(${ref(`room-light-${index}`)})`}
                />
                <path d="M330 105h72l-42 87H267Z" fill={`url(${ref("sunlight")})`} />
                <path d="M334 108h27l-25 74h-30Zm37 0h27l-30 74h-27Z" fill="#fffbe1" opacity=".3" />
                <g transform="translate(30 72)">
                  <use href={ref("shelf")} />
                  <use href={ref("tiny-plant")} x="51" y="-3" />
                  <path d="M9-6h21v6H9Z" fill="#7e725b" />
                  <path d="M12-9h21v6H12Z" fill="#bab297" />
                  <path d="M15-8h15v1H15Z" fill="#d9ccb0" />
                </g>
                <use href={ref("window")} x="327" y="66" />
                <use href={ref("tiny-plant")} x="393" y="108" />
                <use href={ref("plant")} x="36" y="166" />
                <path d="M114 78h3v90h-3Z" fill="#a5af9b" opacity=".6" />
                <path d="M114 78h2v90h-2Z" fill="#6b746d" opacity=".35" />
                {index === 2 &&
                  EXTRA_SEATS.map((seat) => (
                    <use key={seat.x} href={ref("chair")} x={seat.x} y="149" />
                  ))}
                <use href={ref("chair")} x="216" y="149" />
                <use href={ref("desk")} x="147" y="84" />
                <Screen />
                {status === "running" && !teamHalted(state, team) && (
                  <g className="office-work-documents" aria-hidden="true">
                    <g className="office-working-sheet loop">
                      <path
                        d="M270 112h18v24h-18Z"
                        fill="#fffdf5"
                        stroke={room.accent}
                        strokeWidth="1"
                      />
                      <path
                        d="M273 118h12m-12 5h9m-9 5h12"
                        fill="none"
                        stroke={room.accent}
                        strokeWidth="2"
                      />
                    </g>
                    <rect
                      className="office-monitor-scan loop"
                      x="188"
                      y="78"
                      width="55"
                      height="2"
                      fill="#a4f1d1"
                    />
                  </g>
                )}
                {status === "needs_revision" && (
                  <g className="office-review-pile">
                    <path d="M252 111h21v12h-21Z" fill="#d9c9a3" />
                    <path d="M255 108h21v12h-21Z" fill="#efe3c6" />
                    <path d="M258 105h21v12h-21Z" fill="#fffaf0" />
                    <path d="M261 108h12v3h-12Z" fill="#a35c00" />
                    <path d="M261 114h9v3h-9Z" fill="#b8ad8f" />
                  </g>
                )}
                <TeamFurniture index={index} rack={rack} printer={printer} />
                <g className="office-lamp-cone" fill="#ffd66b">
                  <path d="M299 135h18v12h-18Z" opacity=".3" />
                  <path d="M293 147h30v12h-30Z" opacity=".22" />
                  <path d="M287 159h42v15h-42Z" opacity=".15" />
                </g>
                <use href={ref("lamp")} x="308" y="120" />
                <rect className="office-lamp-shade" x="302" y="120" width="12" height="12" />
                <rect className="office-lamp-bulb" x="296" y="132" width="24" height="3" />
                <g
                  className="office-worker-position"
                  style={{
                    transform: `translate(${atDesk ? AT_DESK.x : AT_SIDE.x}px, ${atDesk ? AT_DESK.y : AT_SIDE.y}px)`,
                  }}
                >
                  <g
                    className={`office-worker-routine${status === "running" && !teamHalted(state, team) ? " is-working" : ""}${!focusTeam && currentDelivery?.from === team ? " is-delivering" : ""} loop`}
                  >
                    <PixelPerson shirt={room.shirt} hair={room.hair} variant={index} />
                  </g>
                </g>
                <path d="M154 87h6v6h-6Z" fill={SIGNAL[kind]} />
                {/* Waiting rooms are slightly lowered; rooms that received work stay at daylight. */}
                <rect
                  className="office-room-shade"
                  x="12"
                  y="60"
                  width="412"
                  height="135"
                  fill="#20382f"
                  fillOpacity=".12"
                />
                <path d="M12 195h418v39H12Z" fill="#f8f9f2" />
                <path d="M12 195h418v2H12Z" fill="#dbe2ce" />
                <path d="M21 197h57v1H21Z" fill={room.accent} opacity=".25" />
                <path d="M12 232h418v2H12Z" fill="#d7dfca" />
                {/* Door to the corridor, where the folders pass. */}
                <path d={`M198 ${topRow ? 234 : 0}h3v6h-3Zm33 0h3v6h-3Z`} fill="#9aa58e" />
                <path d={`M201 ${topRow ? 234 : 0}h30v6h-30Z`} fill="#e6d8b8" />
              </g>
            </g>
          </g>
        );
      })}
      <g className="office-cues" data-preview={previewTeam ? "on" : undefined}>
        {TEAMS.filter((team) => !focusTeam || team === focusTeam).map((team) => {
          const index = TEAMS.indexOf(team);
          const room = ROOMS[index];
          const { status, log } = state.teams[team];
          const kind = signalKind(state, team);
          const spot = AWAY.includes(status) ? AT_SIDE : AT_DESK;
          return (
            <g
              key={team}
              className={`office-cue-room ${roomClass(team)}`}
              data-preview={preview(team)}
              transform={`translate(${room.x} ${room.y})`}
            >
              <g className="office-art-room-zoom">
                {index === 2 &&
                  EXTRA_SEATS.slice(0, Math.max(0, crew.count - 1)).map((seat, seatIndex) => (
                    <g
                      key={`seat-${seatIndex}`}
                      className="office-validator"
                      transform={`translate(${seat.x} ${AT_DESK.y})`}
                    >
                      <g className="office-validator-arrive">
                        <PixelPerson shirt={room.shirt} hair={seat.hair} variant={seat.variant} />
                      </g>
                    </g>
                  ))}
                {index === 3 && printed !== null && (
                  <g
                    key={`print-${printed}`}
                    className="office-printout"
                    clipPath={`url(${ref("print-clip")})`}
                  >
                    <g className="office-printout-sheet">
                      <path d="M75 162h27v30H75Z" fill="#4f5d4a" opacity=".25" />
                      <path d="M72 159h27v30H72Z" fill="#fffdf4" />
                      <path d="M72 159h27v3H72Z" fill="#e4e8d6" />
                      <path d="M75 165h15v3H75Z" fill="#1d6b3f" />
                      <path d="M75 171h21v3H75Zm0 6h15v3H75Z" fill="#9aa69a" />
                      <path d="M84 183h12v3H84Z" fill="#20382f" />
                    </g>
                  </g>
                )}
                <g
                  className="office-bubble-position"
                  style={{ transform: `translate(${spot.x}px, ${spot.y}px)` }}
                >
                  {kind !== "none" && (
                    <g className="office-signal" key={`${state.version}-${log.at(-1)?.seq ?? 0}`}>
                      <SignalBubble kind={kind} />
                    </g>
                  )}
                </g>
              </g>
            </g>
          );
        })}
        {pass && !focusTeam && (
          <Envelope key={pass.seq} cue={pass} carried={currentDelivery?.seq === pass.seq} />
        )}
        {currentDelivery && !focusTeam && (
          <DeliveryRunner
            key={`${deliveryScope}:${currentDelivery.seq}`}
            cue={currentDelivery}
            onArrived={() =>
              updateDelivery({ type: "arrived", scope: deliveryScope, seq: currentDelivery.seq })
            }
          />
        )}
      </g>
    </svg>
  );
}
