import { eventClock } from "./officePreview";
import type { OfficeState } from "./officeState";

/** Demo deliverables quote received events; they do not fabricate catalog/API objects. */
export function OfficeDemoResults({ state }: { state: OfficeState }) {
  const candidates = state.teams.design.log.filter((event) => event.type === "task.progress");
  const checks = state.teams.validation.log.filter((event) => event.type === "task.completed");
  const quote = state.teams.quotation.log.findLast((event) => event.type === "task.completed");

  return (
    <div className="results-grid demo-results" data-testid="office-demo-results">
      <section className="panel demo-deliverable" aria-label="데모 추천 및 검증 기록">
        <div className="deliverable-heading">
          <span className="deliverable-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="m12 3 9 5-9 5-9-5 9-5ZM3 13l9 5 9-5M3 18l9 5 9-5" />
            </svg>
          </span>
          <div>
            <span className="deliverable-eyebrow">RECOMMENDATIONS</span>
            <h3>추천 · 검증 기록</h3>
          </div>
          <span className="deliverable-badge">DEMO</span>
        </div>
        {candidates.length === 0 ? (
          <p className="deliverable-empty">후보를 찾으면 이곳에 기록이 쌓입니다.</p>
        ) : (
          <ol className="deliverable-list">
            {[...candidates, ...checks]
              .sort((a, b) => a.seq - b.seq)
              .map((event) => (
                <li key={event.seq}>
                  <span className="deliverable-event">
                    {event.team === "design" ? "탐색" : "검증"}
                  </span>
                  <span>{event.message}</span>
                  <time dateTime={event.occurred_at}>{eventClock(event)}</time>
                </li>
              ))}
          </ol>
        )}
      </section>
      <section className="panel demo-quote" aria-label="데모 참고 견적">
        <div className="deliverable-heading">
          <span className="deliverable-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M6 3h8l4 4v14H6V3ZM14 3v5h4M9 12h6M9 16h4" />
            </svg>
          </span>
          <div>
            <span className="deliverable-eyebrow">QUOTATION</span>
            <h3>참고 견적</h3>
          </div>
          <span className="deliverable-badge">DEMO</span>
        </div>
        <p
          className={`demo-quote-value${quote ? " is-ready" : ""}`}
          data-testid="demo-quotation-summary"
        >
          {quote?.message ?? "견적을 기다리고 있어요"}
        </p>
        <p className="demo-quote-note">
          {quote
            ? "가상 상품의 데모 금액이며 실제 판매가가 아닙니다."
            : "견적팀이 작업을 마치면 수신한 결과를 표시합니다."}
        </p>
        <a className="deliverable-link" href="#workspace">
          팀의 작업 살펴보기 <span aria-hidden="true">↗</span>
        </a>
      </section>
    </div>
  );
}
