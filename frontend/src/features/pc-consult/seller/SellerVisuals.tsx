import { useState } from "react";
import { salesPeriods } from "./mockData";
import type { OfficeState, SalesPart } from "./types";
import "./visuals.css";

const amount = (value: number) => `₩${Math.round(value).toLocaleString("ko-KR")}`;
const quantity = (value: number) => Math.round(value).toLocaleString("ko-KR");

export function SalesTopChart({ parts, limit = 5 }: { parts: SalesPart[]; limit?: number }) {
  const ranked = [...parts].sort((first, second) => second.sales - first.sales).slice(0, limit);
  const maximum = Math.max(1, ...ranked.flatMap((part) => [part.sales, part.demand]));
  return (
    <div className="seller-visual-ranking">
      <div className="seller-visual-legend">
        <span className="seller-visual-key seller-visual-key--sales">실제 판매</span>
        <span className="seller-visual-key seller-visual-key--demand">상담 수요</span>
        <span>가상 시연 수량</span>
      </div>
      <div className="seller-visual-ranked-list" style={{ height: `${ranked.length * 53}px` }}>
        {ranked.map((part, index) => (
          <div
            className="seller-visual-ranked-row"
            key={part.id}
            style={{ transform: `translateY(${index * 53}px)` }}
          >
            <span className="seller-visual-rank">{index + 1}</span>
            <div className="seller-visual-ranked-main">
              <div className="seller-visual-row-heading">
                <span title={part.name}>{part.name}</span>
                <strong>{quantity(part.sales)}개</strong>
              </div>
              <div
                className="seller-visual-bar-track"
                role="img"
                aria-label={`${part.name}, 실제 판매 ${quantity(part.sales)}개, 상담 수요 ${quantity(part.demand)}개`}
              >
                <span
                  className="seller-visual-bar seller-visual-bar--demand"
                  style={{ width: `${(part.demand / maximum) * 100}%` }}
                />
                <span
                  className="seller-visual-bar seller-visual-bar--sales"
                  style={{ width: `${(part.sales / maximum) * 100}%` }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
      {!ranked.length && <p className="seller-visual-muted">판매 현황이 아직 없습니다.</p>}
    </div>
  );
}

export function SalesDashboard({
  parts,
  todaySales,
  quotes,
}: {
  parts: SalesPart[];
  todaySales: number;
  quotes: number;
}) {
  const [period, setPeriod] = useState<keyof typeof salesPeriods>("day");
  const current = salesPeriods[period];
  const ranked = [...parts].sort((first, second) => second.sales - first.sales);
  const sold = parts.reduce((total, part) => total + part.sales, 0) * current.multiplier;
  const revenue =
    parts.reduce((total, part) => total + part.sales * part.price, 0) * current.multiplier;
  const categories = Object.entries(
    parts.reduce<Record<string, number>>((result, part) => {
      result[part.category] = (result[part.category] ?? 0) + part.sales * current.multiplier;
      return result;
    }, {}),
  );
  const weightTotal = current.trendWeights.reduce((total, weight) => total + weight, 0) || 1;
  const periodSales = Math.round(todaySales * current.multiplier);
  let allocatedSales = 0;
  const trend = current.trendWeights.map((weight, index) => {
    const value =
      index === current.trendWeights.length - 1
        ? periodSales - allocatedSales
        : Math.floor((periodSales * weight) / weightTotal);
    allocatedSales += value;
    return value;
  });
  const maximum = Math.max(1, ...trend);
  const points = trend
    .map(
      (value, index) =>
        `${36 + (index / Math.max(1, trend.length - 1)) * 488},${170 - (value / maximum) * 130}`,
    )
    .join(" ");
  const conversion = current.quoteCount ? (current.purchaseCount / current.quoteCount) * 100 : 0;
  const demandParts = ranked.slice(0, 5);
  const demandMaximum = Math.max(1, ...demandParts.flatMap((part) => [part.sales, part.demand]));
  let runningShare = 0;
  return (
    <section className="seller-visual-dashboard" aria-label="판매 분석">
      <div className="seller-visual-dashboard-head">
        <div>
          <span className="seller-visual-eyebrow">판매 흐름</span>
          <h2>데이터로 보는 우리 기업</h2>
          <p>가상 시연 데이터 · 모든 금액은 테스트 가격입니다.</p>
        </div>
        <div className="seller-visual-period" role="group" aria-label="집계 기간">
          {Object.entries(salesPeriods).map(([key, value]) => (
            <button
              key={key}
              type="button"
              aria-pressed={period === key}
              onClick={() => setPeriod(key as keyof typeof salesPeriods)}
            >
              {value.label}
            </button>
          ))}
        </div>
      </div>
      <div className="seller-visual-metrics" aria-live="polite">
        <div>
          <span>{current.label} 판매 금액</span>
          <strong>{amount(revenue)}</strong>
          <small>테스트 가격 기준</small>
        </div>
        <div>
          <span>{current.label} 판매 수량</span>
          <strong>
            {quantity(sold)}
            <small> 개</small>
          </strong>
          <small>가상 시연 집계</small>
        </div>
        <div>
          <span>현재 저장된 견적</span>
          <strong>
            {quantity(quotes)}
            <small> 건</small>
          </strong>
          <small>고객 기록의 견적 표본</small>
        </div>
      </div>
      <div className="seller-visual-charts-grid">
        <article className="seller-visual-chart-card seller-visual-trend-card">
          <div className="seller-visual-card-heading">
            <div>
              <h3>판매 건수 추이</h3>
              <p>
                {current.label} 흐름 · {quantity(periodSales)}건
              </p>
            </div>
            <span className="seller-visual-pill">가상 시연</span>
          </div>
          <svg
            key={period}
            viewBox="0 0 560 218"
            className="seller-visual-trend"
            role="img"
            aria-label={`${current.label} 판매 건수 추이: ${current.labels.map((label, index) => `${label} ${quantity(trend[index])}건`).join(", ")}`}
          >
            <defs>
              <linearGradient id="seller-trend-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--seller-accent, #128878)" stopOpacity=".23" />
                <stop offset="100%" stopColor="var(--seller-accent, #128878)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {[40, 83, 126, 170].map((y, index) => (
              <g key={y}>
                <line x1="36" x2="524" y1={y} y2={y} className="seller-visual-gridline" />
                <text x="36" y={y - 7} className="seller-visual-svg-note">
                  {quantity((maximum * (3 - index)) / 3)}건
                </text>
              </g>
            ))}
            <polygon
              points={`36,180 ${points} 524,180`}
              fill="url(#seller-trend-fill)"
              className="seller-visual-trend-area"
            />
            <polyline points={points} className="seller-visual-trend-line" />
            {trend.map((value, index) => (
              <circle
                key={`${period}-${index}`}
                cx={36 + (index / Math.max(1, trend.length - 1)) * 488}
                cy={170 - (value / maximum) * 130}
                r="4"
                className="seller-visual-trend-dot"
              >
                <title>
                  {current.labels[index]}: {quantity(value)}건
                </title>
              </circle>
            ))}
            {current.labels.map((label, index) => (
              <text
                key={label}
                x={36 + (index / Math.max(1, trend.length - 1)) * 488}
                y="205"
                textAnchor="middle"
                className="seller-visual-svg-label"
              >
                {label}
              </text>
            ))}
          </svg>
          <p className="seller-visual-footnote">기간별 가상 분포에 현재 판매 건수를 반영합니다.</p>
        </article>
        <article className="seller-visual-chart-card">
          <div className="seller-visual-card-heading">
            <div>
              <h3>분류별 판매 비중</h3>
              <p>판매 수량 기준</p>
            </div>
          </div>
          <div className="seller-visual-donut-layout">
            <svg
              viewBox="0 0 200 200"
              className="seller-visual-donut"
              role="img"
              aria-label={categories
                .map(([category, count]) => `${category} ${quantity(count)}개`)
                .join(", ")}
            >
              <circle cx="100" cy="100" r="70" className="seller-visual-donut-track" />
              {categories.map(([category, count], index) => {
                const share = sold ? (count / sold) * 100 : 0;
                const offset = runningShare;
                runningShare += share;
                return (
                  <circle
                    key={category}
                    cx="100"
                    cy="100"
                    r="70"
                    pathLength="100"
                    fill="none"
                    strokeWidth="24"
                    strokeDasharray={`${share} ${100 - share}`}
                    strokeDashoffset={-offset}
                    transform="rotate(-90 100 100)"
                    className={`seller-visual-donut-piece seller-visual-color-${index % 6}`}
                  >
                    <title>
                      {category} {share.toFixed(1)}%
                    </title>
                  </circle>
                );
              })}
              <text x="100" y="93" textAnchor="middle" className="seller-visual-donut-caption">
                판매 수량
              </text>
              <text x="100" y="119" textAnchor="middle" className="seller-visual-donut-total">
                {quantity(sold)}
              </text>
            </svg>
            <ul className="seller-visual-category-legend">
              {categories.map(([category, count], index) => (
                <li key={category}>
                  <span className={`seller-visual-swatch seller-visual-color-${index % 6}`} />
                  <span>{category}</span>
                  <strong>{sold ? ((count / sold) * 100).toFixed(0) : 0}%</strong>
                </li>
              ))}
            </ul>
          </div>
        </article>
        <article className="seller-visual-chart-card">
          <div className="seller-visual-card-heading">
            <div>
              <h3>판매 상위 10개 부품</h3>
              <p>판매 수량이 바뀌면 순위에 반영됩니다.</p>
            </div>
          </div>
          <SalesTopChart
            parts={parts.map((part) => ({
              ...part,
              sales: part.sales * current.multiplier,
              demand: part.demand * current.multiplier,
            }))}
            limit={10}
          />
        </article>
        <div className="seller-visual-chart-stack">
          <article className="seller-visual-chart-card">
            <div className="seller-visual-card-heading">
              <div>
                <h3>상담 수요와 실제 판매</h3>
                <p>판매 상위 5개 · {current.label}</p>
              </div>
            </div>
            <div className="seller-visual-legend">
              <span className="seller-visual-key seller-visual-key--demand">상담 수요</span>
              <span className="seller-visual-key seller-visual-key--sales">실제 판매</span>
            </div>
            <div className="seller-visual-demand-groups">
              {demandParts.map((part) => (
                <div className="seller-visual-demand-group" key={part.id}>
                  <div className="seller-visual-demand-columns">
                    <span
                      className="seller-visual-demand-column seller-visual-demand-column--demand"
                      style={{ height: `${(part.demand / demandMaximum) * 100}%` }}
                    >
                      <span>{quantity(part.demand * current.multiplier)}</span>
                    </span>
                    <span
                      className="seller-visual-demand-column seller-visual-demand-column--sales"
                      style={{ height: `${(part.sales / demandMaximum) * 100}%` }}
                    >
                      <span>{quantity(part.sales * current.multiplier)}</span>
                    </span>
                  </div>
                  <span className="seller-visual-demand-name" title={part.name}>
                    {part.name}
                  </span>
                </div>
              ))}
            </div>
          </article>
          <article className="seller-visual-chart-card seller-visual-conversion">
            <div>
              <span className="seller-visual-eyebrow">견적 → 구매</span>
              <h3>상담이 구매로 이어진 비율</h3>
              <p>
                {current.label} 견적 {quantity(current.quoteCount)}건 중 구매{" "}
                {quantity(current.purchaseCount)}건
              </p>
              <small>별도 견적 표본의 가상 집계 · 실제 고객 전환율이 아닙니다.</small>
            </div>
            <strong>
              {conversion.toFixed(1)}
              <span>%</span>
            </strong>
          </article>
        </div>
      </div>
    </section>
  );
}

const phaseLabels: Record<OfficeState["phase"], string> = {
  idle: "대기",
  talking: "상담 중",
  handoff: "전달 중",
  summary: "요약 완료",
  classifying: "분류 중",
  classified: "분류 완료",
  working: "처리 중",
  done: "완료",
};

export function OfficeView({
  office,
  onOpenIssue,
}: {
  office: OfficeState;
  onOpenIssue: (id: string | null) => void;
}) {
  const [detail, setDetail] = useState<string | null>(null);
  const paperStage = ["idle", "talking"].includes(office.phase)
    ? "consult"
    : ["handoff", "summary"].includes(office.phase)
      ? "desk"
      : "helper";
  return (
    <section className="seller-visual-office" aria-label="기업 업무 오피스">
      <div className="seller-visual-dashboard-head">
        <div>
          <span className="seller-visual-eyebrow">우리 팀의 하루</span>
          <h2>지금, 오피스에서는</h2>
          <p>상담부터 전달, 분류까지 업무 흐름을 살펴보세요.</p>
        </div>
        <span
          className={`seller-visual-office-status ${office.phase !== "idle" ? "is-active" : ""}`}
        >
          <span />
          {phaseLabels[office.phase]}
        </span>
      </div>
      <div className="seller-visual-office-layout">
        <div className="seller-visual-office-main">
          <div className="seller-visual-room">
            <div className="seller-visual-room-window">
              <span />
              <span />
              <span />
            </div>
            <div className="seller-visual-plant" aria-hidden="true">
              ✦<span />
            </div>
            <div className="seller-visual-route" aria-hidden="true">
              <span />
              <span />
            </div>
            <div className="seller-visual-station seller-visual-station--consult">
              <span className="seller-visual-station-number">01</span>
              <h3>상담 창구</h3>
              <div className="seller-visual-desk">
                <span className="seller-visual-monitor" />
                <span className="seller-visual-keyboard" />
              </div>
              <button
                type="button"
                className={`seller-visual-character seller-visual-character--consult ${office.phase === "talking" ? "is-busy" : ""}`}
                aria-label="상담 에이전트 업무 상세"
                onClick={() => setDetail("상담 에이전트")}
              >
                <span className="seller-visual-character-hair" />
                <span className="seller-visual-character-face">
                  <i />
                  <i />
                </span>
                <span className="seller-visual-character-body" />
              </button>
              <p>고객의 요청을 들어요</p>
            </div>
            <div className="seller-visual-station seller-visual-station--desk">
              <span className="seller-visual-station-number">02</span>
              <h3>전달 데스크</h3>
              <div className="seller-visual-desk">
                <span className="seller-visual-document-stack" />
                <span className="seller-visual-tray" />
              </div>
              <button
                type="button"
                className={`seller-visual-character seller-visual-character--desk ${["handoff", "summary"].includes(office.phase) ? "is-busy" : ""}`}
                aria-label="전달 담당자 업무 상세"
                onClick={() => setDetail("전달 담당자")}
              >
                <span className="seller-visual-character-hair" />
                <span className="seller-visual-character-face">
                  <i />
                  <i />
                </span>
                <span className="seller-visual-character-body" />
              </button>
              <p>상담 내용을 정리해요</p>
            </div>
            <div className="seller-visual-station seller-visual-station--helper">
              <span className="seller-visual-station-number">03</span>
              <h3>업무 보조 부서</h3>
              <div className="seller-visual-desk">
                <span className="seller-visual-monitor" />
                <span className="seller-visual-keyboard" />
              </div>
              <button
                type="button"
                className={`seller-visual-character seller-visual-character--helper ${["classifying", "classified", "working"].includes(office.phase) ? "is-busy" : ""}`}
                aria-label="업무 보조 에이전트 상세"
                onClick={() => setDetail("업무 보조 에이전트")}
              >
                <span className="seller-visual-character-hair" />
                <span className="seller-visual-character-face">
                  <i />
                  <i />
                </span>
                <span className="seller-visual-character-body" />
              </button>
              <p>담당 업무를 나눠요</p>
            </div>
            {office.phase !== "idle" && (
              <button
                type="button"
                key={`${office.consultationId}-${office.phase}`}
                className={`seller-visual-paper seller-visual-paper--${paperStage} seller-visual-paper--${office.phase}`}
                aria-label="현재 전달 서류 상세 보기"
                onClick={() => setDetail("현재 전달 서류")}
              >
                <span />
                <span />
                <span />
                <i />
              </button>
            )}
            {office.phase !== "idle" && (
              <div className="seller-visual-customer">
                <span className="seller-visual-customer-head" />
                <span className="seller-visual-customer-body" />
                <span>고객</span>
              </div>
            )}
            <div className="seller-visual-drawers" aria-label="업무 분류 서랍">
              {["이슈", "클레임", "오류"].map((kind) => (
                <button type="button" key={kind} onClick={() => onOpenIssue(null)}>
                  <span />
                  {kind}
                  <i />
                </button>
              ))}
            </div>
          </div>
          <div className="seller-visual-office-caption" aria-live="polite">
            <span className="seller-visual-bubble-icon" aria-hidden="true">
              ···
            </span>
            <div>
              <strong>{office.customerId || "상담 대기"}</strong>
              <p>{office.bubble || "새로운 고객의 상담을 기다리고 있어요."}</p>
            </div>
          </div>
          {detail && (
            <div
              className="seller-visual-office-detail"
              role="region"
              aria-label={`${detail} 상세`}
            >
              <button
                className="seller-visual-detail-close"
                type="button"
                aria-label="업무 상세 닫기"
                onClick={() => setDetail(null)}
              >
                ×
              </button>
              <span className="seller-visual-eyebrow">{detail}</span>
              <h3>{office.issueId || office.consultationId || "배정된 업무 없음"}</h3>
              <dl>
                <div>
                  <dt>현재 상태</dt>
                  <dd>{phaseLabels[office.phase]}</dd>
                </div>
                <div>
                  <dt>요약</dt>
                  <dd>{office.bubble || "새 상담이 시작되면 업무 내용이 표시됩니다."}</dd>
                </div>
              </dl>
              <button
                type="button"
                className="seller-visual-open-issue"
                onClick={() => onOpenIssue(office.issueId)}
              >
                처리함에서 보기 <span aria-hidden="true">↗</span>
              </button>
            </div>
          )}
        </div>
        <aside className="seller-visual-office-log">
          <div className="seller-visual-card-heading">
            <h3>오피스 기록</h3>
            <span className="seller-visual-pill">진행 상황</span>
          </div>
          <ol aria-live="polite" aria-relevant="additions">
            {office.log.length ? (
              office.log.map((line, index) => (
                <li key={`${index}-${line}`}>
                  <span className="seller-visual-log-dot" />
                  <span>{line}</span>
                </li>
              ))
            ) : (
              <li>
                <span className="seller-visual-log-dot" />
                <span>업무가 시작되면 기록이 쌓입니다.</span>
              </li>
            )}
          </ol>
          <p className="seller-visual-footnote">업무 처리는 처리함에서 진행해 주세요.</p>
        </aside>
      </div>
    </section>
  );
}
