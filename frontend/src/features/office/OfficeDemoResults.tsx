import { eventClock } from "./officePreview";
import type { OfficeState } from "./officeState";

/** Demo deliverables quote received events; they do not fabricate catalog/API objects. */
export function OfficeDemoResults({ state }: { state: OfficeState }) {
  const candidates = state.teams.design.log.filter((event) => event.type === "task.progress");
  const checks = state.teams.validation.log.filter((event) => event.type === "task.completed");
  const quote = state.teams.quotation.log.findLast((event) => event.type === "task.completed");

  return (
    <div className="results-grid demo-results" data-testid="office-demo-results">
      <section className="panel demo-deliverable" aria-labelledby="demo-records-title">
        <div className="deliverable-heading">
          <span className="deliverable-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="m12 3 9 5-9 5-9-5 9-5ZM3 13l9 5 9-5M3 18l9 5 9-5" />
            </svg>
          </span>
          <h3 id="demo-records-title">추천 · 검증 기록</h3>
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
                    {event.team === "design" ? "후보" : "검증"}
                  </span>
                  <span>{event.message}</span>
                  <time dateTime={event.occurred_at}>{eventClock(event)}</time>
                </li>
              ))}
          </ol>
        )}
      </section>
      <section className="panel demo-quote" aria-labelledby="demo-quote-title">
        <div className="deliverable-heading">
          <span className="deliverable-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M6 3h8l4 4v14H6V3ZM14 3v5h4M9 12h6M9 16h4" />
            </svg>
          </span>
          <h3 id="demo-quote-title">견적·주문팀 결과</h3>
        </div>
        <p
          className={`demo-quote-value${quote ? " is-ready" : ""}`}
          data-testid="demo-quotation-summary"
        >
          {quote?.message ?? "견적을 기다리고 있어요"}
        </p>
        <p className="demo-quote-note">
          {quote
            ? "가상 상품으로 낸 금액이라 실제 판매가가 아닙니다."
            : "견적·주문팀이 끝내면 금액이 여기에 나와요."}
        </p>
        <a className="deliverable-link" href="#workspace">
          사무실 보기
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
          </svg>
        </a>
      </section>
    </div>
  );
}
