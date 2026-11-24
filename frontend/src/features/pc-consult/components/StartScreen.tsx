import type { AccountKind } from "../types";

export function StartScreen({
  onEnter,
  onBusinessEnter,
}: {
  onEnter: (kind: AccountKind) => void;
  onBusinessEnter: () => void;
}) {
  return (
    <div className="pc-start">
      <section className="pc-hero" aria-labelledby="pc-welcome-title">
        <span className="pc-eyebrow">나의 장비부터 기업의 고객센터까지</span>
        <h1 id="pc-welcome-title">
          더 나은 선택,
          <br />
          함께 만드는 내일.
        </h1>
        <p className="pc-hero-copy">
          개인에게는 나에게 맞는 PC 상담을.
          <br />
          기업에게는 한눈에 보이는 AI 고객센터를.
        </p>
        <div className="pc-machine" aria-hidden="true">
          <svg viewBox="0 0 580 350" fill="none">
            <defs>
              <linearGradient
                id="pc-tower-side"
                x1="260"
                y1="50"
                x2="460"
                y2="300"
                gradientUnits="userSpaceOnUse"
              >
                <stop stopColor="#d4dff4" />
                <stop offset="1" stopColor="#a2b5d6" />
              </linearGradient>
              <linearGradient
                id="pc-tower-glass"
                x1="156"
                y1="85"
                x2="332"
                y2="290"
                gradientUnits="userSpaceOnUse"
              >
                <stop stopColor="#243f6a" />
                <stop offset="1" stopColor="#101e38" />
              </linearGradient>
            </defs>
            <ellipse cx="305" cy="312" rx="185" ry="20" fill="#183d80" opacity=".08" />
            <path d="M178 75 313 35 420 80 288 125Z" fill="#e4ebf9" stroke="#a7badb" />
            <path d="m288 125 132-45v200l-132 47Z" fill="url(#pc-tower-side)" stroke="#93a9cf" />
            <path d="M178 75 288 125v202l-110-55Z" fill="#eef3fc" stroke="#a7badb" />
            <path d="m190 95 86 38v170l-86-42Z" fill="url(#pc-tower-glass)" />
            <path d="m205 124 55 26v59l-55-26Z" fill="#406295" stroke="#6f94c8" />
            <path d="m213 140 34 16v32l-34-16Z" fill="#a3c9ff" />
            <path d="m202 220 62 29v14l-62-29Z" fill="#759bce" />
            <path d="m200 244 64 30v11l-64-30Z" fill="#263c5d" />
            <ellipse
              cx="354"
              cy="143"
              rx="32"
              ry="37"
              transform="rotate(17 354 143)"
              fill="#526d98"
            />
            <ellipse
              cx="354"
              cy="143"
              rx="23"
              ry="28"
              transform="rotate(17 354 143)"
              stroke="#c8e2ff"
              strokeWidth="4"
            />
            <path d="m354 130 7 12-7 14-7-12Z" fill="#bed7fc" />
            <ellipse
              cx="354"
              cy="229"
              rx="32"
              ry="37"
              transform="rotate(17 354 229)"
              fill="#526d98"
            />
            <ellipse
              cx="354"
              cy="229"
              rx="23"
              ry="28"
              transform="rotate(17 354 229)"
              stroke="#c8e2ff"
              strokeWidth="4"
            />
            <path d="m354 216 7 12-7 14-7-12Z" fill="#bed7fc" />
            <path d="m302 99 42-14" stroke="#8a9fc0" strokeWidth="4" strokeLinecap="round" />
            <circle cx="367" cy="77" r="4" fill="#2457d6" />
            <rect x="87" y="172" width="105" height="49" rx="12" fill="white" stroke="#d7e3f4" />
            <path
              d="m102 196 6 6 12-14"
              stroke="#1f8a4c"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M132 189h43m-43 12h28"
              stroke="#91a6c6"
              strokeWidth="4"
              strokeLinecap="round"
            />
            <rect x="399" y="118" width="95" height="49" rx="12" fill="white" stroke="#d7e3f4" />
            <rect x="413" y="134" width="15" height="18" rx="3" fill="#dbe7fc" />
            <path
              d="M441 135h36m-36 13h24"
              stroke="#91a6c6"
              strokeWidth="4"
              strokeLinecap="round"
            />
          </svg>
        </div>
      </section>
      <section className="pc-login" aria-labelledby="pc-login-title">
        <h2 id="pc-login-title">어디에서 시작할까요?</h2>
        <div className="pc-entry-choices">
          <button className="pc-entry-card" onClick={onBusinessEnter}>
            <span className="pc-entry-symbol" aria-hidden="true">
              ▦
            </span>
            <span>
              <strong>기업</strong>
              <small>AI 고객센터와 판매 현황을 관리해요.</small>
            </span>
            <b aria-hidden="true">→</b>
          </button>
          <button className="pc-entry-card" onClick={() => onEnter("personal")}>
            <span className="pc-entry-symbol" aria-hidden="true">
              ◇
            </span>
            <span>
              <strong>개인</strong>
              <small>부품 교체와 새 PC 조립을 상담해요.</small>
            </span>
            <b aria-hidden="true">→</b>
          </button>
        </div>
      </section>
    </div>
  );
}
