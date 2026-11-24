/* Tabler, TailAdmin and PlainAdmin (MIT) component layouts adapted; ../THIRD_PARTY_NOTICES.md. */
import { useState } from "react";
import type { AgentEvent, Team } from "../../../api/client";
import { OfficeBoard } from "../../office/OfficeBoard";
import { STATUS_LABELS, TEAM_LABELS, TEAMS, type OfficeState } from "../../office/officeState";
import type { CatalogSummary } from "../types";
import { CATEGORY_LABELS } from "../types";
import type { ReviewSelection } from "../reviewSelectionStore";
import { FEEDBACK_DEMO } from "./mockData";
import type { SellerMenu, SellerSession } from "./types";
import type { useSellerDemo } from "./useSellerDemo";
import "../teamTheme.css";
import "./management.css";

type Controller = ReturnType<typeof useSellerDemo>;
type Navigate = (menu: SellerMenu) => void;

const TEAM_ROLES: Record<Team, { role: string; autonomy: string; approval: string }> = {
  consultation: {
    role: "고객의 요청과 조건을 정리하고 다음 담당 팀에 전달합니다.",
    autonomy: "요청 정리 · 상담 요약",
    approval: "개인정보와 민감한 문의는 담당자가 확인합니다.",
  },
  design: {
    role: "연결된 상품과 정책을 바탕으로 후보와 인계 내용을 정리합니다.",
    autonomy: "후보 정리 · 인계 문서 작성",
    approval: "확인되지 않은 상품 조건은 담당자가 확인합니다.",
  },
  validation: {
    role: "근거와 조건을 확인하고 검토가 필요한 요청을 분류합니다.",
    autonomy: "조건 확인 · 클레임 분류",
    approval: "확인 불가 항목과 클레임 처리는 담당자가 결정합니다.",
  },
  quotation: {
    role: "확정된 선택으로 견적을 정리하고 승인 여부를 기다립니다.",
    autonomy: "견적 정리 · 승인 대기",
    approval: "최종 견적과 주문은 사용자 승인이 필요합니다.",
  },
};

function StatusPill({ status }: { status: keyof typeof STATUS_LABELS }) {
  return (
    <span className={`management-status management-status-${status}`}>{STATUS_LABELS[status]}</span>
  );
}

/** TailAdmin monthly-target's arc + value + supporting metrics composition, rendered with our SVG. */
function ResolutionGauge({ resolved, total }: { resolved: number; total: number }) {
  const percent = total ? Math.round((resolved / total) * 100) : 0;
  return (
    <div
      className="management-gauge"
      role="img"
      aria-label={`가상 상담 자동 해결률 ${percent}퍼센트, ${total}건 중 ${resolved}건`}
    >
      <svg viewBox="0 0 260 150" aria-hidden="true">
        <path className="management-gauge-track" d="M25 126a105 105 0 0 1 210 0" pathLength="100" />
        <path
          className="management-gauge-value"
          d="M25 126a105 105 0 0 1 210 0"
          pathLength="100"
          strokeDasharray={`${percent} 100`}
        />
      </svg>
      <div>
        <strong>
          {percent}
          <small>%</small>
        </strong>
        <span>가상 상담 {total}건 기준</span>
      </div>
    </div>
  );
}

export function ManagementHome({
  controller,
  session,
  catalog,
  onNavigate,
  onOpenIssue,
  onOpenAbuse,
}: {
  controller: Controller;
  session: SellerSession;
  catalog: CatalogSummary | null;
  onNavigate: Navigate;
  onOpenIssue: (id: string) => void;
  onOpenAbuse: () => void;
}) {
  const { state, office } = controller;
  const [highlight, setHighlight] = useState<Team | null>(null);
  const openIssues = state.issues.filter((issue) => issue.stage !== "done");
  const operations = controller.operations;
  // Explicit mock consultation cohort, separate from task.completed office events.
  const performance = controller.performance;
  const quoteRate = performance.consultations
    ? Math.round((performance.quoted / performance.consultations) * 100)
    : 0;
  const metrics = [
    {
      label: "상담 처리 완료",
      value: `${performance.completed}건`,
      detail: `가상 상담 ${performance.consultations}건 중`,
      icon: "✓",
    },
    {
      label: "평균 첫 응답",
      value: `${performance.averageResponseSeconds}초`,
      detail: "가상 응대 시간 표본",
      icon: "◷",
    },
    {
      label: "사람에게 인계",
      value: `${performance.handedOff}건`,
      detail: "담당자가 이어받은 가상 상담",
      icon: "↗",
    },
    {
      label: "견적 도달률",
      value: `${quoteRate}%`,
      detail: `가상 상담 중 ${performance.quoted}건`,
      icon: "▤",
    },
  ];
  return (
    <div className="seller-management management-home" data-highlight={highlight ?? undefined}>
      <section className="management-hero" aria-label="기업 AI 상담팀 운영실">
        <header className="management-heading">
          <div>
            <span className="sr-only">{session.companyName}의 AI 상담팀</span>
            <h1>
              상담은 AI 팀에게, <span className="management-hero-break">중요한 결정은 함께.</span>
            </h1>
            <p>우리 기업의 상품과 정책으로, 고객의 첫 질문부터 견적까지 이어갑니다.</p>
          </div>
          <button className="management-primary" onClick={() => onNavigate("preview")}>
            고객 화면 미리보기 <span aria-hidden="true">↗</span>
          </button>
        </header>
        <div className="management-company-strip">
          <div>
            <span className="management-company-mark" aria-hidden="true">
              {session.companyName.slice(0, 1)}
            </span>
            <div>
              <strong>{session.companyName}</strong>
              <span>기업용 시연 · 실제 인증과 DB 연결 없음</span>
            </div>
          </div>
          <button onClick={() => onNavigate("catalog")}>
            <span>취급 상품</span>
            <strong>
              {catalog ? `${catalog.scopedParts.toLocaleString("ko-KR")}개` : "집계 중"}
            </strong>
            <span aria-hidden="true">›</span>
          </button>
          <div className="management-live">
            <span aria-hidden="true" />
            받은 이벤트로 업무 상태를 보여드려요.
          </div>
        </div>
      </section>
      <div className="management-office-grid">
        <section className="management-office-area" aria-label="AI 팀 오피스">
          <h2 className="sr-only">우리 기업의 AI 오피스</h2>
          <p className="management-office-help">팀을 눌러 진행 중인 업무를 자세히 보세요. ↗</p>
          <div className="management-office-board">
            <OfficeBoard state={office} />
          </div>
          <div className="management-team-strip" aria-label="AI 팀 현재 상태">
            {TEAMS.map((team) => (
              <button
                className="management-team-summary"
                data-team={team}
                key={team}
                onMouseEnter={() => setHighlight(team)}
                onMouseLeave={() => setHighlight(null)}
                onFocus={() => setHighlight(team)}
                onBlur={() => setHighlight(null)}
                onClick={() => onNavigate("teams")}
              >
                <span className="management-team-dot" aria-hidden="true" />
                <strong>{TEAM_LABELS[team]}</strong>
                <StatusPill status={office.teams[team].status} />
                <span className="management-team-task">
                  진행 작업 {office.teams[team].activeTasks}개
                </span>
              </button>
            ))}
          </div>
          <p className="management-office-note">
            오피스는 실제 받은 시연 이벤트만 표시합니다. 기업의 상담 인계와 클레임 분류는 PC 견적
            완료를 뜻하지 않습니다.
          </p>
        </section>
        {/* Tabler Tasks card's heading + compact task rows, with accessible action buttons. */}
        <aside
          className="management-card management-human-card"
          aria-labelledby="management-human-title"
        >
          <div className="management-section-heading">
            <div>
              <span className="management-eyebrow">사람의 판단이 필요한 순간</span>
              <h2 id="management-human-title">
                확인을 기다려요 <span>{openIssues.length}</span>
              </h2>
            </div>
          </div>
          <p className="management-card-description">
            AI가 정리한 요청을 확인하고 다음 결정을 내려 주세요.
          </p>
          <div className="management-task-list">
            {openIssues.slice(0, 3).map((issue, index) => (
              <button key={issue.id} onClick={() => onOpenIssue(issue.id)}>
                <span className="management-task-number" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="management-task-content">
                  <span
                    className={`management-tag ${issue.kind === "오류" ? "management-tag-error" : "management-tag-attention"}`}
                  >
                    {issue.kind}
                  </span>
                  <strong>{issue.title}</strong>
                  {issue.dataOrigin && (
                    <span className="management-tag management-tag-attention">실제 시연</span>
                  )}
                  <small>{issue.assignee || "담당자 지정 필요"}</small>
                </div>
                <span className="management-task-arrow" aria-hidden="true">
                  ↗
                </span>
              </button>
            ))}
            {!openIssues.length && (
              <div className="management-honest-empty">
                <strong>새 요청을 기다리고 있어요.</strong>
                <p>검토가 필요한 요청이 생기면 여기에 모아 드립니다.</p>
              </div>
            )}
          </div>
          <button className="management-outline" onClick={() => onNavigate("issues")}>
            상담 · 이슈 전체 보기
          </button>
          <button className="management-outline" onClick={onOpenAbuse}>
            욕설 감지 {state.alerts.filter((alert) => !alert.ignored).length}건 · 확인하기
          </button>
          <small className="management-sample-note">
            가상 요청 {openIssues.filter((issue) => !issue.dataOrigin).length}건 · 실제 시연 요청{" "}
            {openIssues.filter((issue) => issue.dataOrigin).length}건입니다.
          </small>
        </aside>
      </div>
      <div className="management-section-heading management-performance-title">
        <div>
          <h2>상담 운영을 한눈에</h2>
          <p>{performance.label}</p>
        </div>
        <span className="management-chip">모든 성과 수치는 가상입니다.</span>
      </div>
      {/* TailAdmin ecommerce-metrics: icon, label, prominent value, supporting detail. */}
      <div className="management-metrics">
        {metrics.map((metric) => (
          <section className="management-metric" key={metric.label}>
            <span className="management-metric-symbol" aria-hidden="true">
              {metric.icon}
            </span>
            <span>{metric.label}</span>
            <strong key={metric.value}>{metric.value}</strong>
            <small>{metric.detail}</small>
          </section>
        ))}
      </div>
      <div className="management-bottom-grid">
        <section className="management-card management-resolution">
          <div className="management-section-heading">
            <h2>AI 자동 해결률</h2>
            <span className="management-chip">가상</span>
          </div>
          <ResolutionGauge
            resolved={performance.automaticallyResolved}
            total={performance.consultations}
          />
          <p>
            가상 상담 {performance.consultations}건 중 {performance.automaticallyResolved}건을 AI가
            단독으로 마친 표본입니다.
          </p>
          <div className="management-resolution-details">
            <div>
              <strong>{performance.automaticallyResolved}건</strong>
              <span>AI 단독 완료</span>
            </div>
            <div>
              <strong>{performance.handedOff}건</strong>
              <span>사람 인계</span>
            </div>
          </div>
          <small>팀별 작업 완료 수와는 별도로 집계합니다.</small>
        </section>
        {/* Tabler activity list: timeline marker, action text and timestamp; real event records only. */}
        <section className="management-card management-activity">
          <div className="management-section-heading">
            <div>
              <h2>지금까지의 팀 활동</h2>
              <p>이 화면에서 받은 시연 이벤트 기록입니다.</p>
            </div>
            <span className="management-chip">{operations.length}건</span>
          </div>
          {operations.length ? (
            <ol>
              {operations.slice(0, 5).map((activity) => (
                <li key={activity.id} data-team={activity.team ?? undefined}>
                  <span className="management-activity-dot" aria-hidden="true" />
                  <button onClick={() => onNavigate(activity.menu)}>
                    <strong>{activity.text}</strong>
                    <small>{activity.time}</small>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <div className="management-onboarding">
              <span className="management-onboarding-icon" aria-hidden="true">
                ↗
              </span>
              <div>
                <strong>새 상담을 받을 준비를 하고 있어요.</strong>
                <p>시연 제어에서 상담을 시작하면 팀의 작업 기록이 차례로 나타납니다.</p>
                <button className="management-text-button" onClick={() => onNavigate("catalog")}>
                  상품 · 정책 연결 확인하기 →
                </button>
              </div>
            </div>
          )}
          <div className="management-activity-foot">
            <span>
              오늘 상담 {state.todayConsultations}건 · 완료 {state.completedConsultations}건
            </span>
            <span>가상 운영 데이터</span>
          </div>
        </section>
      </div>
    </div>
  );
}

const FEEDBACK_GROUPS = [
  { key: "intents", title: "어떤 목적으로 찾았나요?", description: "상담에서 많이 나온 사용 목적" },
  {
    key: "conditions",
    title: "어떤 조건을 원하나요?",
    description: "고객이 자주 언급한 구매 조건",
  },
  {
    key: "complaints",
    title: "어떤 점이 불편했나요?",
    description: "담당자의 확인이 필요한 불편 사항",
  },
  { key: "dropoffs", title: "어디에서 상담을 멈췄나요?", description: "가상 상담의 중단 이유" },
  { key: "handoffs", title: "어떤 요청을 전달했나요?", description: "사람에게 이어진 확인 요청" },
] as const;

export function FeedbackPanel({
  onNavigate,
  reviewSelections = [],
}: {
  onNavigate: Navigate;
  reviewSelections?: readonly ReviewSelection[];
}) {
  return (
    <div className="seller-management management-feedback">
      <header className="management-heading">
        <div>
          <span className="management-eyebrow">고객의 목소리에서 다음 할 일을 찾아요.</span>
          <h1>고객 피드백</h1>
          <p>실제 브라우저 시연의 선택 이력과 가상 상담 분석 표본을 구분해 보여 드립니다.</p>
        </div>
        <span className="management-chip">실제 시연 · 가상 분석 구분</span>
      </header>
      <section
        className="management-card management-review-feedback"
        data-testid="review-selection-feedback"
        aria-labelledby="review-feedback-title"
      >
        <div className="management-section-heading">
          <div>
            <span className="management-tag management-tag-attention">실제 시연 집계</span>
            <h2 id="review-feedback-title">상품 정보 보강 필요</h2>
            <p>
              확인 불가 경고를 확인하고 선택한 전체 이력입니다. 현재 구성의 부품 수와 다를 수
              있습니다.
            </p>
          </div>
          <strong className="management-review-count">
            <span data-testid="review-selection-count">{reviewSelections.length}</span>건
          </strong>
        </div>
        <p className="management-card-description">
          {new Set(reviewSelections.map((entry) => entry.consultationId)).size}개 상담 · 같은 상담의
          같은 분류·제품은 한 건으로 집계합니다. 이 기업의 ‘처음으로’ 또는 새로고침 시 초기화됩니다.
          DB에는 기록하지 않습니다.
        </p>
        {reviewSelections.length ? (
          <details className="management-review-records">
            <summary>선택 제품과 확인 불가 사유 {reviewSelections.length}건 보기</summary>
            <ul>
              {reviewSelections.map((entry) => (
                <li key={entry.key}>
                  <strong>
                    {CATEGORY_LABELS[entry.category]} · {entry.productName}
                  </strong>
                  <p>{entry.reasons.join(" · ")}</p>
                  <small>{entry.sourceKey}</small>
                </li>
              ))}
            </ul>
          </details>
        ) : (
          <p className="management-honest-empty">
            이 기업에서 경고를 확인하고 선택한 부품이 아직 없습니다.
          </p>
        )}
        <div className="management-review-actions">
          <button className="management-outline" onClick={() => onNavigate("issues")}>
            선택 사유를 사람 인계함에서 보기 ↗
          </button>
          <button className="management-outline" onClick={() => onNavigate("documents")}>
            상품 정보 보강 자료 확인 ↗
          </button>
        </div>
      </section>
      <div className="management-feedback-grid">
        {FEEDBACK_GROUPS.map((group) => {
          const rows = FEEDBACK_DEMO[group.key];
          const max = Math.max(...rows.map((row) => row.value), 1);
          return (
            <section className="management-card management-feedback-chart" key={group.key}>
              <div className="management-section-heading">
                <div>
                  <h2>{group.title}</h2>
                  <p>{group.description} · 가상 건수</p>
                </div>
              </div>
              <ul>
                {rows.map((row) => (
                  <li key={row.label}>
                    <div>
                      <span>{row.label}</span>
                      <strong>{row.value}건</strong>
                    </div>
                    <div className="management-feedback-track" aria-hidden="true">
                      <span style={{ width: `${(row.value / max) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      <section className="management-card management-feedback-actions">
        <div className="management-section-heading">
          <div>
            <h2>이렇게 개선해 볼 수 있어요.</h2>
            <p>가상 피드백에서 정리한 운영 제안입니다. 정책은 담당자가 확인한 뒤 변경합니다.</p>
          </div>
        </div>
        <div>
          {FEEDBACK_DEMO.actions.map((action) => (
            <article key={action.id}>
              <span
                className={`management-tag ${action.kind === "불만" ? "management-tag-attention" : "management-tag-positive"}`}
              >
                {action.kind}
              </span>
              <div>
                <h3>{action.topic}</h3>
                <p>{action.message}</p>
                <small>가상 의견 {action.count}건</small>
              </div>
              <button className="management-outline" onClick={() => onNavigate(action.action)}>
                {action.actionLabel} <span aria-hidden="true">↗</span>
              </button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

export function AiTeamsPanel({
  office,
  events = [],
}: {
  office: OfficeState;
  events?: AgentEvent[];
}) {
  return (
    <section
      className="seller-management management-ai-teams"
      aria-labelledby="management-ai-title"
    >
      <div className="management-heading">
        <div>
          <span className="management-eyebrow">같은 목표로 움직이는 네 팀</span>
          <h1 id="management-ai-title">AI 직원</h1>
          <p>역할과 자율 처리 범위를 확인하세요. 상태는 받은 시연 이벤트에 따라 바뀝니다.</p>
        </div>
        <span className="management-chip">실제 AI · 백엔드 연결 전</span>
      </div>
      <div className="management-ai-grid">
        {TEAMS.map((team) => {
          const current = office.teams[team];
          const role = TEAM_ROLES[team];
          return (
            <article className="management-card management-ai-card" data-team={team} key={team}>
              <header>
                <span className="management-ai-avatar" aria-hidden="true">
                  {TEAM_LABELS[team].slice(0, 1)}
                </span>
                <div>
                  <h2>{TEAM_LABELS[team]}</h2>
                  <StatusPill status={current.status} />
                </div>
              </header>
              <p>{role.role}</p>
              <dl>
                <div>
                  <dt>오늘 처리한 작업</dt>
                  <dd>
                    {
                      events.filter(
                        (event) =>
                          event.team === team &&
                          event.type === "task.completed" &&
                          new Date(event.occurred_at).toLocaleDateString("ko-KR", {
                            timeZone: "Asia/Seoul",
                          }) === new Date().toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" }),
                      ).length
                    }
                    개 · 이번 시연에서 받은 완료 기록
                  </dd>
                </div>
                <div>
                  <dt>자율 처리</dt>
                  <dd>{role.autonomy}</dd>
                </div>
                <div>
                  <dt>사람의 확인</dt>
                  <dd>{role.approval}</dd>
                </div>
                <div>
                  <dt>현재 작업</dt>
                  <dd>
                    {current.activeTasks}개 진행 중 · 기록 {current.log.length}건
                  </dd>
                </div>
              </dl>
              <div className="management-ai-latest">
                <span>최근 받은 업무</span>
                <p>{current.message || "아직 받은 업무가 없습니다. 새 요청을 기다리고 있어요."}</p>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
