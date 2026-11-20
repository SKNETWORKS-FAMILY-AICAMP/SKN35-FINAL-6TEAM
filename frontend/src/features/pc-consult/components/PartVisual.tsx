import { useId, useState, type ReactNode } from "react";
import { CATEGORY_LABELS, type Category, type Part } from "../types";
import "./partVisual.css";

/** These category illustrations are not photographs or claims about a particular product. */
function HardwareIllustration({ category }: { category: Category }) {
  const id = useId().replace(/:/g, "");
  const metal = `url(#${id}-metal)`;
  const dark = `url(#${id}-dark)`;
  const glass = `url(#${id}-glass)`;
  const fan = (x: number, y: number, r: number) => (
    <g>
      <circle cx={x} cy={y} r={r + 3} fill="#101f2b" stroke="#657984" strokeWidth="2" />
      <circle cx={x} cy={y} r={r} fill="#233746" stroke="#3c6a74" strokeWidth="2" />
      {Array.from({ length: 7 }, (_, index) => (
        <path
          key={index}
          d={`M${x} ${y - 3} Q${x - r * 0.85} ${y - r * 1.05} ${x - r * 0.85} ${y - r * 0.25} Q${x - r * 0.3} ${y + 4} ${x} ${y + 3}Z`}
          fill="#819ba4"
          opacity=".75"
          transform={`rotate(${index * (360 / 7)} ${x} ${y})`}
        />
      ))}
      <circle cx={x} cy={y} r={r * 0.23} fill="#d7e6e7" />
      <circle cx={x} cy={y} r={r * 0.11} fill="#7ea0a4" />
    </g>
  );
  const artwork: Record<Category, ReactNode> = {
    cpu: (
      <g transform="translate(110 89) rotate(-12) translate(-110 -89)">
        <path d="M54 49 73 35h94v94l-18 17H54Z" fill="#1c5255" />
        <rect
          x="50"
          y="45"
          width="104"
          height="104"
          rx="5"
          fill="#255f5f"
          stroke="#6da9a1"
          strokeWidth="2"
        />
        {Array.from({ length: 12 }, (_, i) => (
          <g key={i} fill="#d0b66c">
            <rect x={55 + i * 8} y="39" width="4" height="8" rx="1" />
            <rect x={55 + i * 8} y="148" width="4" height="7" rx="1" />
          </g>
        ))}
        <rect
          x="61"
          y="53"
          width="82"
          height="84"
          rx="8"
          fill={metal}
          stroke="#f2ffff"
          strokeWidth="1.5"
        />
        <path d="M69 64h66M70 127h65" stroke="#a3bac0" />
        <path d="M82 82h39v27H82z" fill="#a3b5bb" opacity=".5" />
        <path d="M89 89h25m-25 6h19m-19 6h22" stroke="#627d85" strokeWidth="2" />
        <path d="m66 123 5-5 5 5" fill="#788e93" />
      </g>
    ),
    motherboard: (
      <g transform="translate(110 91) rotate(-9) translate(-110 -91)">
        <rect
          x="53"
          y="24"
          width="114"
          height="137"
          rx="5"
          fill="#172b37"
          stroke="#5d7883"
          strokeWidth="2"
        />
        <path
          d="M66 31v120m13-120v124m76-123v120M63 130h91M73 114h84"
          stroke="#44636c"
          strokeWidth="1"
        />
        <rect x="83" y="51" width="42" height="42" fill={metal} stroke="#8aa1a7" strokeWidth="3" />
        <rect x="89" y="57" width="30" height="30" rx="2" fill="#56747d" />
        <rect x="61" y="36" width="13" height="61" rx="2" fill={metal} />
        <rect x="84" y="31" width="40" height="12" rx="2" fill="#7b979e" />
        {[136, 147].map((x) => (
          <rect key={x} x={x} y="42" width="6" height="63" rx="1" fill="#a6b7b9" />
        ))}
        {[105, 118, 140].map((y) => (
          <rect key={y} x="80" y={y} width="62" height="6" rx="1" fill="#91a4a8" />
        ))}
        <path d="M121 129h30v24h-30z" fill={dark} stroke="#436c70" />
        <circle cx="66" cy="118" r="7" fill="#c9d9d9" />
        {[
          [58, 29],
          [161, 29],
          [58, 155],
          [161, 155],
        ].map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="2.5" fill="#d1bc77" />
        ))}
      </g>
    ),
    ram: (
      <g transform="rotate(-14 110 96)">
        <path d="M31 72 47 57h143v51l-16 13H31Z" fill="#253d4b" stroke="#6b8890" />
        <path d="M31 78h145v49H31Z" fill="#153c3b" />
        <path d="M30 76h146v41H30Z" fill={dark} stroke="#91a7ad" strokeWidth="1.5" />
        <path d="M33 77h141l15-14H48Z" fill={metal} />
        <path d="M37 88h21l8 17h33l9-17h59" fill="none" stroke="#72d8c4" strokeWidth="3" />
        {Array.from({ length: 16 }, (_, i) => (
          <rect key={i} x={35 + i * 8.5} y="118" width="5" height="9" fill="#cab774" />
        ))}
        <path d="M101 119h5v9h-5Z" fill="#edf4f0" />
        <rect x="49" y="67" width="122" height="3" rx="1" fill="#9df2de" />
      </g>
    ),
    gpu: (
      <g transform="rotate(-9 110 96)">
        <path d="m29 61 18-14h153v71l-18 14H29Z" fill="#445965" stroke="#8b9fa5" />
        <path d="M29 61h153v71H29Z" fill={dark} stroke="#93aab0" strokeWidth="1.5" />
        <path d="m29 61 18-14h153l-18 14" fill={metal} />
        <path d="M29 56H18v88h13" fill="#71848d" stroke="#a4b7bc" strokeWidth="2" />
        <path d="M62 132v8h72v-8" fill="#c5ad69" />
        {fan(74, 97, 25)}
        {fan(140, 97, 25)}
        <path d="M40 66h130" stroke="#64d9c1" strokeWidth="3" />
        <path d="m189 68 6-5v45l-6 5" fill="#21323f" />
      </g>
    ),
    storage: (
      <g transform="rotate(-15 110 95)">
        <path d="M27 70h165v52H27Z" fill="#28534f" stroke="#70988e" strokeWidth="2" />
        <path d="M27 70v52h-7v-18h4V88h-4V70Z" fill="#c9b872" />
        <rect x="36" y="75" width="114" height="42" rx="3" fill={dark} />
        <path d="M43 80h99v31H43Z" fill="#b5c7c7" />
        <path d="M51 86h43m-43 7h72m-72 7h62" stroke="#607981" strokeWidth="3" />
        <rect x="157" y="78" width="26" height="34" rx="2" fill="#1f343d" />
        <circle cx="189" cy="96" r="4" fill="#d6ca97" />
        <circle cx="189" cy="96" r="2" fill="#204941" />
        <path d="M30 119h150" stroke="#8edac5" />
      </g>
    ),
    cooler: (
      <g>
        <path d="M72 37h68l27 18v96H70Z" fill={metal} stroke="#91a7b0" />
        {Array.from({ length: 13 }, (_, i) => (
          <path
            key={i}
            d={`M72 ${43 + i * 7}h67l27 17`}
            fill="none"
            stroke="#718e9a"
            strokeWidth="2"
          />
        ))}
        <path
          d="M81 132v24q0 11 12 11h28q10 0 10-10v-15"
          stroke="#b98a5b"
          strokeWidth="7"
          fill="none"
        />
        <rect
          x="49"
          y="61"
          width="94"
          height="94"
          rx="8"
          fill={dark}
          stroke="#8099a4"
          strokeWidth="2"
        />
        {fan(96, 108, 37)}
        {[
          [57, 69],
          [135, 69],
          [57, 147],
          [135, 147],
        ].map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="2.4" fill="#c2d5d8" />
        ))}
      </g>
    ),
    psu: (
      <g>
        <path d="m41 63 36-24h102v98l-36 26H41Z" fill="#405866" stroke="#8a9da5" />
        <path d="M41 63h102v100H41Z" fill={dark} stroke="#a2b8bc" strokeWidth="1.5" />
        <path d="m41 63 36-24h102l-36 24" fill={metal} />
        {fan(92, 111, 36)}
        <path d="M60 88h64M57 99h71M57 111h71M58 123h69M65 135h53" stroke="#b7c9cd" opacity=".65" />
        <path d="M154 80h14v24h-14z" fill="#17232d" />
        <path d="M155 115h12m-12 7h12m-12 7h12" stroke="#8aabb0" strokeWidth="2" />
      </g>
    ),
    case: (
      <g>
        <path d="m64 31 62-15 45 20v124l-61 17-46-21Z" fill="#364c5d" stroke="#8aa5ae" />
        <path d="m64 31 46 19v127l-46-21Z" fill={dark} stroke="#8eaab5" />
        <path d="m110 50 61-14v124l-61 17Z" fill="#273e4a" stroke="#a5bdc4" />
        <path d="m117 58 46-11v105l-46 13Z" fill={glass} />
        <ellipse cx="141" cy="80" rx="16" ry="18" fill="#203d46" stroke="#6ecab9" strokeWidth="3" />
        <ellipse
          cx="141"
          cy="123"
          rx="16"
          ry="18"
          fill="#203d46"
          stroke="#87aaeb"
          strokeWidth="3"
        />
        <ellipse cx="141" cy="80" rx="5" ry="6" fill="#86bdbd" />
        <ellipse cx="141" cy="123" rx="5" ry="6" fill="#8dadd1" />
        <path d="m71 48 32 13v91l-32-13Z" fill="#628897" opacity=".28" />
        <path d="m74 161 9 4v7l-9-4m69-1 10-3v7l-10 3" fill="#162b38" />
        <path d="m123 36 20-5m9-2 5-1" stroke="#d4e3e4" strokeWidth="3" />
      </g>
    ),
  };
  return (
    <svg className="pc-hardware-art" viewBox="0 0 220 190" fill="none" aria-hidden="true">
      <defs>
        <linearGradient
          id={`${id}-metal`}
          x1=".1"
          y1="0"
          x2=".9"
          y2="1"
          gradientUnits="objectBoundingBox"
        >
          <stop stopColor="#edf7f8" />
          <stop offset=".45" stopColor="#b2c6cc" />
          <stop offset="1" stopColor="#79939f" />
        </linearGradient>
        <linearGradient
          id={`${id}-dark`}
          x1="0"
          y1="0"
          x2="1"
          y2="1"
          gradientUnits="objectBoundingBox"
        >
          <stop stopColor="#526d7a" />
          <stop offset=".45" stopColor="#2b4252" />
          <stop offset="1" stopColor="#172b39" />
        </linearGradient>
        <linearGradient
          id={`${id}-glass`}
          x1="0"
          y1="0"
          x2="1"
          y2="1"
          gradientUnits="objectBoundingBox"
        >
          <stop stopColor="#9fd8d6" stopOpacity=".34" />
          <stop offset="1" stopColor="#395b71" stopOpacity=".12" />
        </linearGradient>
      </defs>
      <ellipse cx="111" cy="172" rx="70" ry="9" fill="#123d49" opacity=".08" />
      {artwork[category]}
    </svg>
  );
}

export type ProductVisualMap = Record<string, Pick<Part, "image_url" | "brand">>;

export function PartVisual({
  category,
  name,
  imageUrl,
  size = "card",
  caption = true,
}: {
  category: Category;
  name: string;
  imageUrl?: string | null;
  size?: "card" | "thumbnail" | "compact";
  caption?: boolean;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const source = imageUrl?.trim() || null;
  const available = source !== null && source !== failedUrl;
  const loaded = available && loadedUrl === source;
  const failed = source !== null && source === failedUrl;
  return (
    <figure className={`pc-part-visual pc-part-visual-${size}`} data-category={category}>
      <div className="pc-part-visual-stage">
        {!loaded && <HardwareIllustration category={category} />}
        {available && (
          <img
            className={loaded ? "pc-part-photo pc-part-photo-loaded" : "pc-part-photo"}
            src={source}
            alt={`${name} 제품 이미지`}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoadedUrl(source)}
            onError={() => setFailedUrl(source)}
          />
        )}
      </div>
      {caption && (
        <figcaption>
          {loaded
            ? "제품 이미지"
            : available
              ? "제품 이미지를 불러오고 있어요"
              : failed
                ? "이미지를 불러오지 못했어요 · 분류 예시"
                : "제품 이미지 미등록 · 분류 예시"}
        </figcaption>
      )}
      {!caption && !loaded && (
        <span className="pc-sr-only">
          {CATEGORY_LABELS[category]} 분류 예시 ·{" "}
          {available
            ? "제품 이미지를 불러오고 있어요"
            : failed
              ? "이미지를 불러오지 못했어요"
              : "제품 이미지 미등록"}
        </span>
      )}
    </figure>
  );
}
