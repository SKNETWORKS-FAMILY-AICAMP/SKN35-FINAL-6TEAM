import { useId } from "react";
import "./welcomeVisual.css";

function Fan({
  x,
  y,
  radius = 26,
  tint = "#81f2ca",
}: {
  x: number;
  y: number;
  radius?: number;
  tint?: string;
}) {
  return (
    <g transform={`translate(${x} ${y}) scale(${radius / 26})`}>
      <rect
        x="-29"
        y="-29"
        width="58"
        height="58"
        rx="8"
        fill="#0a171b"
        stroke="#6f8983"
        strokeWidth="1"
      />
      {[-23, 23].flatMap((cx) =>
        [-23, 23].map((cy) => (
          <circle key={`${cx}:${cy}`} cx={cx} cy={cy} r="1.6" fill="#c1d0c6" />
        )),
      )}
      <circle r="25" fill="#101e24" stroke="#a2b8af" strokeWidth="1.4" />
      <circle
        className="bw-product-ring-glow"
        r="23"
        fill="none"
        stroke={tint}
        strokeWidth="6"
        opacity=".24"
      />
      <circle r="22.9" fill="none" stroke={tint} strokeWidth="2.7" />
      <circle r="20.3" fill="none" stroke="#dbf5e8" strokeWidth=".6" opacity=".6" />
      <g className="bw-product-fan-rotor">
        <circle r="20" fill="none" />
        {Array.from({ length: 7 }, (_, i) => (
          <path
            key={i}
            d="M-3-5C-13-11-14-18-5-20C5-21 9-16 8-11L4-4Z"
            transform={`rotate(${(i * 360) / 7})`}
            fill="#6b8581"
            stroke="#bbcfc3"
            strokeWidth=".45"
          />
        ))}
      </g>
      <circle r="6.5" fill="#1b3435" stroke="#c5e2d0" strokeWidth="1" />
      <circle r="3" fill="#a8beb3" />
      <path
        d="M-15-17A23 23 0 0 1 14-18"
        fill="none"
        stroke="#e0fff1"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity=".8"
      />
    </g>
  );
}

/** 외부 이미지나 상품 사양을 사용하지 않는 장식용 PC 구성 예시입니다. */
export function WelcomeVisual({
  frameless = false,
  showCaption = true,
}: {
  frameless?: boolean;
  showCaption?: boolean;
}) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const paint = (name: string) => `url(#${id}-${name})`;
  return (
    <figure className={`bw-welcome-visual${frameless ? " bw-welcome-visual-frameless" : ""}`}>
      <svg viewBox="0 0 560 390" role="img" aria-label="PC 구성 예시 일러스트" focusable="false">
        <defs>
          <radialGradient id={`${id}-atmosphere`} cx=".52" cy=".45" r=".7">
            <stop stopColor="#1c4a43" />
            <stop offset=".57" stopColor="#102b2c" />
            <stop offset="1" stopColor="#0c2023" />
          </radialGradient>
          <radialGradient id={`${id}-halo`}>
            <stop stopColor="#90f6ce" stopOpacity=".36" />
            <stop offset="1" stopColor="#4ccbad" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${id}-top`} x1="0" y1="0" x2=".7" y2="1">
            <stop stopColor="#e0e7e2" />
            <stop offset=".38" stopColor="#96aaa3" />
            <stop offset=".65" stopColor="#5f7873" />
            <stop offset="1" stopColor="#2a4145" />
          </linearGradient>
          <linearGradient id={`${id}-frame`} x1="0" y1="0" x2="1" y2=".8">
            <stop stopColor="#d3e0d8" />
            <stop offset=".09" stopColor="#8da79a" />
            <stop offset=".24" stopColor="#32524b" />
            <stop offset=".85" stopColor="#2a4543" />
            <stop offset="1" stopColor="#93b4a2" />
          </linearGradient>
          <linearGradient id={`${id}-front`} x1="0" y1="0" x2="1" y2=".3">
            <stop stopColor="#d9e7dc" />
            <stop offset=".12" stopColor="#819f91" />
            <stop offset=".35" stopColor="#28453f" />
            <stop offset="1" stopColor="#48665b" />
          </linearGradient>
          <linearGradient id={`${id}-interior`} x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#10292a" />
            <stop offset=".6" stopColor="#09181e" />
            <stop offset="1" stopColor="#18302d" />
          </linearGradient>
          <linearGradient id={`${id}-glass`} x1="0" y1="0" x2="1" y2=".7">
            <stop stopColor="#eefaf5" stopOpacity=".25" />
            <stop offset=".42" stopColor="#c7e5d9" stopOpacity=".03" />
            <stop offset=".43" stopColor="#ffffff" stopOpacity=".18" />
            <stop offset=".55" stopColor="#c4e0d5" stopOpacity=".03" />
            <stop offset="1" stopColor="#a7ceba" stopOpacity=".025" />
          </linearGradient>
          <linearGradient id={`${id}-steel`} x1="0" y1="0" x2="0" y2="1">
            <stop stopColor="#edf4ef" />
            <stop offset=".12" stopColor="#b8c9c0" />
            <stop offset=".2" stopColor="#687c7b" />
            <stop offset=".8" stopColor="#233b3e" />
            <stop offset="1" stopColor="#b3c9bc" />
          </linearGradient>
          <linearGradient id={`${id}-light`}>
            <stop stopColor="#72f0c0" stopOpacity=".1" />
            <stop offset=".5" stopColor="#b5ffe0" />
            <stop offset="1" stopColor="#72f0c0" stopOpacity=".1" />
          </linearGradient>
          <linearGradient id={`${id}-pedestal`} x1="0" y1="0" x2="0" y2="1">
            <stop stopColor={frameless ? "#edf1e6" : "#31584b"} />
            <stop offset=".2" stopColor={frameless ? "#dce6d6" : "#1a3734"} />
            <stop offset="1" stopColor={frameless ? "#bdcabb" : "#0d2227"} />
          </linearGradient>
          <pattern id={`${id}-mesh`} width="4" height="4" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r=".7" fill="#48685d" opacity=".45" />
          </pattern>
          <pattern id={`${id}-floor`} width="38" height="38" patternUnits="userSpaceOnUse">
            <path d="M38 0H0V38" fill="none" stroke="#a0e7cb" strokeWidth=".5" opacity=".11" />
          </pattern>
          <filter id={`${id}-glow`} x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="8" />
          </filter>
          <filter id={`${id}-shadow`} x="-40%" y="-30%" width="180%" height="190%">
            <feDropShadow
              dx="-5"
              dy="17"
              stdDeviation="12"
              floodColor="#000f13"
              floodOpacity={frameless ? ".25" : ".7"}
            />
          </filter>
        </defs>

        {!frameless && <rect width="560" height="390" rx="28" fill={paint("atmosphere")} />}
        <ellipse
          className="bw-product-ambient"
          cx="306"
          cy="194"
          rx="202"
          ry="163"
          fill={paint("halo")}
        />
        <path d="M0 331 560 190v200H0Z" fill={paint("floor")} opacity=".55" />
        <path
          d="M28 321 292 246 528 313M75 343l219-64 179 45"
          fill="none"
          stroke="#80bfa1"
          strokeWidth=".6"
          opacity=".18"
        />
        <ellipse
          cx="290"
          cy="339"
          rx="179"
          ry="33"
          fill="#030f14"
          opacity={frameless ? ".12" : ".55"}
          filter={paint("glow")}
        />
        <ellipse cx="292" cy="339" rx="160" ry="31" fill={paint("pedestal")} />
        <ellipse
          cx="292"
          cy="332"
          rx="160"
          ry="29"
          fill={frameless ? "#e3eadd" : "#193c34"}
          stroke={frameless ? "#bacab7" : "#476e5b"}
          strokeWidth=".6"
        />
        <path
          d="M137 337c29 22 255 34 311-3"
          fill="none"
          stroke={paint("light")}
          strokeWidth="1"
          opacity=".6"
        />

        <g className="bw-product-tower" filter={paint("shadow")}>
          <path
            d="m175 286 13 3v25l-13-4Zm163 40 14 3v24l-14-4Zm65-37 12-6v24l-12 6Z"
            fill="#07181b"
            stroke="#3a5a4c"
            strokeWidth=".6"
          />
          <path
            d="m165 57 71-34 193 46-72 34Z"
            fill={paint("top")}
            stroke="#dbe7db"
            strokeWidth=".9"
          />
          <path d="m181 56 56-25 172 40-54 25Z" fill="#162d30" stroke="#93b3a3" strokeWidth=".7" />
          {Array.from({ length: 17 }, (_, n) => (
            <path
              key={n}
              d={`m${202 + n * 9.2} ${48 + n * 2.15} 27-12`}
              stroke="#a3bdb0"
              strokeWidth="2"
              opacity=".65"
            />
          ))}
          <path
            d="m165 57 192 46v238l-192-46Z"
            fill={paint("frame")}
            stroke="#bfd8c6"
            strokeWidth=".9"
          />
          <path
            d="m357 103 72-34v238l-72 34Z"
            fill={paint("front")}
            stroke="#a4c2ae"
            strokeWidth=".8"
          />

          <g transform="matrix(1 .2396 0 1 165 57)">
            <rect
              x="7"
              y="8"
              width="178"
              height="216"
              rx="3"
              fill={paint("interior")}
              stroke="#6a9380"
              strokeWidth=".75"
            />
            <rect
              x="19"
              y="24"
              width="148"
              height="153"
              rx="3"
              fill="#112b29"
              stroke="#324b40"
              strokeWidth=".6"
            />
            <g fill="none" stroke="#345e4a" strokeWidth=".7" opacity=".85">
              <path d="M29 45h23v25h24m-44 8h15v37h30m-50 16h28v11h90M80 36v15h13v26m55-32h-12v73h-12m29 34h-22v15H74" />
              <path d="M35 36v18m7 2v11M26 88h8v39m76-87v82h18m25-61h8v47h-12M62 108v16H46" />
              {[29, 46, 75, 96, 147].map((x) => (
                <circle key={x} cx={x} cy={128 + (x % 3) * 7} r="1.6" fill="#839573" />
              ))}
            </g>
            <rect x="29" y="34" width="44" height="19" rx="2" fill="#587469" />
            {Array.from({ length: 9 }, (_, i) => (
              <path key={i} d={`M${32 + i * 4.5} 36v15`} stroke="#203b36" strokeWidth="1.7" />
            ))}
            <rect x="24" y="63" width="12" height="62" rx="1" fill="#5f766a" />
            {Array.from({ length: 12 }, (_, i) => (
              <path key={i} d={`M25 ${66 + i * 4.7}h10`} stroke="#263d36" strokeWidth="1.5" />
            ))}

            <path
              d="M79 70C79 48 91 32 106 30s28 1 35 20"
              fill="none"
              stroke="#050f14"
              strokeWidth="7"
            />
            <path
              d="M87 75C84 51 99 40 109 40s18 3 26 13"
              fill="none"
              stroke="#07151a"
              strokeWidth="6"
            />
            <path
              d="M79 69C79 48 91 32 106 30s28 1 35 20M87 75C84 51 99 40 109 40s18 3 26 13"
              fill="none"
              stroke="#638e7b"
              strokeWidth="1"
              opacity=".7"
            />
            <rect
              x="54"
              y="67"
              width="48"
              height="48"
              rx="7"
              fill="#0b1c20"
              stroke="#748f7b"
              strokeWidth="1"
            />
            <rect
              x="59"
              y="72"
              width="38"
              height="38"
              rx="6"
              fill="#28443c"
              stroke="#a7ebc0"
              strokeWidth="1.3"
            />
            <circle cx="78" cy="91" r="12" fill="#0d2928" stroke="#86e2b1" strokeWidth="1.4" />
            <path d="M72 88h5v5h-5Zm7-5h5v5h-5Zm0 7h5v5h-5Z" fill="#b2f4cb" />
            {[117, 130, 143].map((x) => (
              <g key={x}>
                <rect
                  x={x}
                  y="59"
                  width="8"
                  height="65"
                  rx="1"
                  fill="#1e3733"
                  stroke="#6e8f76"
                  strokeWidth=".6"
                />
                <rect
                  x={x + 1.5}
                  y="60"
                  width="5"
                  height="58"
                  rx="1"
                  fill="#8ad9b2"
                  opacity={x === 130 ? ".9" : ".55"}
                />
                <path d={`M${x + 2} 65v47`} stroke="#d1ffe1" strokeWidth=".6" />
              </g>
            ))}

            <g transform="translate(19 145)">
              <path
                d="M0 3 10-5h137l8 7v32H0Z"
                fill={paint("steel")}
                stroke="#81968b"
                strokeWidth=".7"
              />
              <path d="M7 9h139v18H7Z" fill="#14282a" />
              {Array.from({ length: 24 }, (_, n) => (
                <path key={n} d={`M${10 + n * 4} 10v16`} stroke="#587166" strokeWidth="1.3" />
              ))}
              <path d="M0 1h153" stroke="#cfebd9" strokeWidth="1.3" />
              <path d="M10 31h131" stroke="#9af1c2" strokeWidth="1.8" />
              <rect
                x="115"
                y="9"
                width="30"
                height="17"
                rx="2"
                fill="#273f38"
                stroke="#587768"
                strokeWidth=".7"
              />
              <path d="M121 14h17m-17 5h12" stroke="#a4bbae" strokeWidth="1.4" />
              <rect
                x="143"
                y="-3"
                width="9"
                height="7"
                fill="#09191b"
                stroke="#54715e"
                strokeWidth=".8"
              />
            </g>
            <path d="M168 150c11-12 9-31 9-44" fill="none" stroke="#172c27" strokeWidth="6" />
            <path d="M168 150c11-12 9-31 9-44" fill="none" stroke="#7c9d80" strokeWidth="1" />
            <path d="M8 193h176v31H8Z" fill="#142e2c" />
            <path d="M8 193h176" stroke="#709581" strokeWidth=".6" />
            {Array.from({ length: 14 }, (_, n) => (
              <rect
                key={n}
                x={21 + n * 5}
                y="203"
                width="2"
                height="11"
                rx="1"
                fill="#4d6e5c"
                opacity=".6"
              />
            ))}
            <path d="M129 207h34m-34 4h23" stroke="#738e79" strokeWidth="1" />
            <rect x="8" y="9" width="177" height="215" rx="3" fill={paint("glass")} />
            <path d="M9 11 169 11 10 185Z" fill="#d7fff0" opacity=".035" />
            <path d="M10 12v209" stroke="#d5f7dd" strokeWidth=".7" opacity=".7" />
            {[13, 179].flatMap((x) =>
              [15, 216].map((y) => (
                <g key={`${x}:${y}`}>
                  <circle cx={x} cy={y} r="2" fill="#809c87" />
                  <path d={`M${x - 0.8} ${y}h1.6`} stroke="#213d33" strokeWidth=".6" />
                </g>
              )),
            )}
          </g>

          <g transform="matrix(1 -.4722 0 1 357 103)">
            <path d="M5 8h62v218H5Z" fill="#0b1c21" stroke="#3c5f50" strokeWidth=".6" />
            <Fan x={36} y={46} radius={25} tint="#a0e6c0" />
            <Fan x={36} y={117} radius={25} tint="#82d7c5" />
            <Fan x={36} y={188} radius={25} tint="#b1dcb2" />
            <rect x="5" y="8" width="62" height="218" fill={paint("mesh")} opacity=".5" />
            <path d="M3 8v218" stroke="#b2e9c8" strokeWidth="1" opacity=".8" />
            <path d="M68 9v216" stroke="#8be1b8" strokeWidth=".8" opacity=".45" />
            <rect x="15" y="231" width="43" height="2" rx="1" fill="#527967" />
            <circle cx="53" cy="2" r="2.2" fill="#bbf7d1" />
            <rect x="20" y="1" width="8" height="2" rx=".8" fill="#89a791" />
            <rect x="32" y="1" width="8" height="2" rx=".8" fill="#89a791" />
          </g>
          <path d="m165 57 192 46v238" fill="none" stroke="#b4d9c2" strokeWidth=".7" opacity=".8" />
          <path d="m357 103 72-34" fill="none" stroke="#b7daca" strokeWidth="1" />
        </g>

        <g className="bw-product-reflection" opacity=".6">
          <ellipse
            cx="363"
            cy="344"
            rx="39"
            ry="7"
            fill="#85ecc2"
            opacity=".15"
            filter={paint("glow")}
          />
          <ellipse
            cx="229"
            cy="322"
            rx="48"
            ry="9"
            fill="#67d6b1"
            opacity=".14"
            filter={paint("glow")}
          />
        </g>
        <path
          d="M66 150h35m-17-17v34M469 237h22m-11-11v22"
          stroke="#8ad4b5"
          strokeWidth=".6"
          opacity=".35"
        />
        <circle cx="100" cy="274" r="2" fill="#8ed1b4" opacity=".5" />
        <circle cx="458" cy="139" r="1.5" fill="#b4e7d0" opacity=".7" />
        <path d="M49 349h57m348-285h56" stroke="#b3d9c6" strokeWidth=".6" opacity=".2" />
      </svg>
      {showCaption && <figcaption>PC 구성 예시 일러스트 · 실제 상품 사진이 아닙니다.</figcaption>}
    </figure>
  );
}
