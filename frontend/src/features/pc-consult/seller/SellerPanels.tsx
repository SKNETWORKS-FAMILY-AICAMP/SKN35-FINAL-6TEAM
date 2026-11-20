import { useEffect, useState, type FormEvent } from "react";
import { Modal } from "../components/ui";
import { won } from "../types";
import { SalesDashboard, SalesTopChart } from "./SellerVisuals";
import { OfficeBoard } from "../../office/OfficeBoard";
import { TEAM_LABELS } from "../../office/officeState";
import { issueTimeline } from "./operations";
import type { Customer, SellerIssue, SellerQuote, SellerSession } from "./types";
import type { useSellerDemo } from "./useSellerDemo";

type Controller = ReturnType<typeof useSellerDemo>;
interface PanelProps {
  controller: Controller;
  session: SellerSession;
}
const KIND_LABELS = ["전체", "개인", "학생", "스타트업", "연구실"] as const;
const STAGES = [
  { value: "received", label: "받은", description: "새로 도착한 문의" },
  { value: "classified", label: "분류됨", description: "담당자 배정 대기" },
  { value: "working", label: "처리 중", description: "담당자가 확인 중" },
  { value: "done", label: "완료", description: "해결된 문의" },
] as const;

export function HomePanel({ controller, session }: PanelProps) {
  const { state, navigate } = controller;
  const openIssues = state.issues.filter((issue) => issue.stage !== "done").length;
  const metrics = [
    {
      title: "오늘의 상담",
      value: `${state.todayConsultations}건`,
      detail: `진행 중 ${state.activeConsultations}건 · 대기 ${state.waitingConsultations}건`,
      mark: "↗",
      color: "teal",
    },
    {
      title: "처리 대기 이슈",
      value: `${openIssues}건`,
      detail: `전체 ${state.issues.length}건 중 처리 전`,
      mark: "!",
      color: "teal",
    },
    {
      title: "오늘 판매 건수",
      value: `${state.todaySales}건`,
      detail: "가상 판매 데이터 · 실제 판매 아님",
      mark: "✓",
      color: "teal",
    },
    {
      title: "욕설 감지 알림",
      value: `${state.alerts.filter((alert) => !alert.ignored).length}건`,
      detail: "감지 후 담당자 확인이 필요해요",
      mark: "◇",
      color: "teal",
    },
  ];
  return (
    <>
      <div className="seller-welcome">
        <div>
          <span className="seller-eyebrow">오늘도 함께 만드는 좋은 상담</span>
          <h1>{session.companyName}의 오늘을 확인하세요.</h1>
          <p>상담부터 고객 관리까지, 중요한 소식을 한눈에 모았어요.</p>
        </div>
        <span className="seller-live-tag">
          <i />
          시연 상태 실시간 반영
        </span>
      </div>
      <div className="seller-metrics">
        {metrics.map((metric) => (
          <section className="seller-metric" key={metric.title}>
            <div>
              <span>{metric.title}</span>
              <i className={`seller-metric-icon seller-icon-${metric.color}`}>{metric.mark}</i>
            </div>
            <strong key={metric.value}>{metric.value}</strong>
            <p>{metric.detail}</p>
          </section>
        ))}
      </div>
      <div className="seller-home-grid">
        <section className="seller-card">
          <div className="seller-card-heading">
            <div>
              <h2>지금 진행 중인 상담</h2>
              <p>가상 오피스의 현재 상태와 연결되어 있어요.</p>
            </div>
            <button className="seller-text-button" onClick={() => navigate("office")}>
              오피스 보기 <span aria-hidden="true">↗</span>
            </button>
          </div>
          <div className="seller-consult-counters">
            <div>
              <span className="seller-dot seller-dot-teal" />
              진행 중<strong>{state.activeConsultations}</strong>
            </div>
            <div>
              <span className="seller-dot seller-dot-amber" />
              대기 중<strong>{state.waitingConsultations}</strong>
            </div>
            <div>
              <span className="seller-dot seller-dot-muted" />
              완료<strong>{state.completedConsultations}</strong>
            </div>
          </div>
          <div className="seller-office-preview">
            <span aria-hidden="true">◉</span>
            <div>
              <strong>
                {state.office.phase === "idle"
                  ? "새로운 상담을 기다리고 있어요."
                  : state.office.bubble || "상담 업무를 진행하고 있어요."}
              </strong>
              <p>시연 제어에서 상담을 시작하면 오피스와 현황이 함께 바뀌어요.</p>
            </div>
          </div>
        </section>
        <section className="seller-card">
          <div className="seller-card-heading">
            <div>
              <h2>최근 활동</h2>
              <p>업무가 움직일 때마다 기록됩니다.</p>
            </div>
            <span className="seller-soft-label">실시간</span>
          </div>
          <ol className="seller-feed">
            {state.feed.slice(0, 5).map((activity) => (
              <li key={activity.id}>
                <span className="seller-feed-dot" />
                <button onClick={() => navigate(activity.menu)}>
                  {activity.text}
                  <small>{activity.time}</small>
                </button>
              </li>
            ))}
          </ol>
          {state.feed.length === 0 && <p className="seller-empty">아직 활동 내역이 없습니다.</p>}
        </section>
      </div>
      <div className="seller-home-grid">
        <section className="seller-card">
          <div className="seller-card-heading">
            <div>
              <h2>많이 선택한 부품</h2>
              <p>판매 수량 상위 5개 · 가상 데이터</p>
            </div>
            <button className="seller-text-button" onClick={() => navigate("sales")}>
              판매 현황 보기 ↗
            </button>
          </div>
          <SalesTopChart parts={state.parts} limit={5} />
        </section>
        <section className="seller-card">
          <div className="seller-card-heading">
            <div>
              <h2>먼저 확인해 주세요</h2>
              <p>담당자의 확인이 필요한 요청입니다.</p>
            </div>
            <span className="seller-count">{openIssues}</span>
          </div>
          <div className="seller-recent-issues">
            {state.issues
              .filter((issue) => issue.stage !== "done")
              .slice(0, 4)
              .map((issue) => (
                <button key={issue.id} onClick={() => navigate("issues")}>
                  <span
                    className={`seller-label seller-label-${issue.kind === "오류" ? "red" : "amber"}`}
                  >
                    {issue.kind}
                  </span>
                  <span>
                    <strong>{issue.title}</strong>
                    <small>
                      {state.customers.find((customer) => customer.id === issue.customerId)?.name ??
                        "고객 정보 확인 필요"}
                    </small>
                  </span>
                  <span aria-hidden="true">›</span>
                </button>
              ))}
          </div>
          {openIssues === 0 && <p className="seller-empty">처리가 필요한 이슈가 없습니다.</p>}
        </section>
      </div>
    </>
  );
}

function QuoteDetail({ quote, onClose }: { quote: SellerQuote; onClose: () => void }) {
  return (
    <Modal title="견적 상세" onClose={onClose}>
      <p className="seller-subtle">
        {quote.id} · {quote.date} · 가상 견적
      </p>
      <ul className="seller-quote-items">
        {quote.items.map((item, index) => (
          <li key={`${item.name}-${index}`}>
            <span>
              {item.name}
              <small>수량 {item.quantity}개</small>
            </span>
            <strong>{won(item.price * item.quantity)}</strong>
          </li>
        ))}
      </ul>
      <div className="seller-quote-total">
        <span>전체 견적 금액</span>
        <strong>{won(quote.total)}</strong>
      </div>
      <p className="seller-demo-note">시연용 견적이며 실제 주문이나 결제가 이루어지지 않습니다.</p>
    </Modal>
  );
}

function CustomerDetail({
  customer,
  controller,
  onClose,
  initialBlocking = false,
}: {
  customer: Customer;
  controller: Controller;
  onClose: () => void;
  initialBlocking?: boolean;
}) {
  const { state, dispatch, canManage } = controller;
  const [tab, setTab] = useState<"quotes" | "chats" | "summary">("quotes");
  const [quote, setQuote] = useState<SellerQuote | null>(null);
  const [blocking, setBlocking] = useState(false);
  useEffect(() => {
    if (initialBlocking) setBlocking(true);
  }, [initialBlocking]);
  const [reason, setReason] = useState("");
  const quotes = state.quotes.filter((item) => item.customerId === customer.id);
  const consultations = state.consultations.filter((item) => item.customerId === customer.id);
  return (
    <Modal
      title={`${customer.name} 고객 정보`}
      className="seller-customer-drawer"
      onClose={onClose}
    >
      <div className="seller-customer-detail">
        <div className="seller-customer-banner">
          <span className="seller-avatar">{customer.name.slice(0, 1)}</span>
          <div>
            <h3>{customer.name}</h3>
            <p>
              {customer.kind} · {customer.id}
            </p>
          </div>
          <span className={`seller-label seller-label-${customer.blocked ? "red" : "teal"}`}>
            {customer.blocked ? "차단됨" : "상담 가능"}
          </span>
        </div>
        <div className="seller-tabs" aria-label="고객 상세 정보">
          {(
            [
              { value: "quotes", label: `견적 내역 ${quotes.length}` },
              { value: "chats", label: "상담 내역" },
              { value: "summary", label: "상담 요약" },
            ] as const
          ).map((item) => (
            <button
              key={item.value}
              className={tab === item.value ? "seller-active" : ""}
              aria-pressed={tab === item.value}
              onClick={() => setTab(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {tab === "quotes" && (
          <div className="seller-detail-list">
            {quotes.length ? (
              quotes.map((item) => (
                <button key={item.id} onClick={() => setQuote(item)}>
                  <span>
                    <strong>{item.id}</strong>
                    <small>
                      {item.date} · {item.items.length}개 품목
                    </small>
                  </span>
                  <strong>{won(item.total)}</strong>
                  <span aria-hidden="true">↗</span>
                </button>
              ))
            ) : (
              <p className="seller-empty">아직 작성된 견적이 없습니다.</p>
            )}
          </div>
        )}
        {tab === "chats" && (
          <div className="seller-chat-history">
            {consultations.length ? (
              consultations.map((consultation) => (
                <details key={consultation.id} className="seller-chat-session">
                  <summary>{consultation.date} 상담 · 채팅 펼치기</summary>
                  <p className="seller-subtle">{consultation.id}</p>
                  {consultation.lines.map((line, index) => (
                    <div
                      className={`seller-chat seller-chat-${line.speaker === "고객" ? "customer" : "agent"}`}
                      key={index}
                    >
                      <small>{line.speaker}</small>
                      <p>{line.text}</p>
                    </div>
                  ))}
                </details>
              ))
            ) : (
              <p className="seller-empty">아직 상담 내역이 없습니다.</p>
            )}
          </div>
        )}
        {tab === "summary" && (
          <div className="seller-summary-list">
            {consultations.length ? (
              consultations.map((consultation) => (
                <section key={consultation.id}>
                  <h3>{consultation.date} 상담 요약</h3>
                  {consultation.summary ? (
                    <dl>
                      <div>
                        <dt>고객 요청</dt>
                        <dd>{consultation.summary.request}</dd>
                      </div>
                      <div>
                        <dt>추천 내용</dt>
                        <dd>{consultation.summary.recommendation}</dd>
                      </div>
                      <div>
                        <dt>주의할 점</dt>
                        <dd>{consultation.summary.attention}</dd>
                      </div>
                    </dl>
                  ) : (
                    <p className="seller-empty">
                      아직 상담 요약이 만들어지지 않았습니다. 상담 인계 후 확인해 주세요.
                    </p>
                  )}
                </section>
              ))
            ) : (
              <p className="seller-empty">요약할 상담이 없습니다.</p>
            )}
          </div>
        )}
        <section className="seller-customer-control">
          <h3>고객 이용 관리</h3>
          {customer.blocked && (
            <div className="seller-warning">
              <strong>현재 차단된 고객입니다.</strong>
              <p>사유: {customer.blockReason}</p>
              <small>
                {customer.blockedBy} · {customer.blockedAt}
              </small>
            </div>
          )}
          {!canManage && (
            <p className="seller-subtle">
              차단과 해제는 관리자 권한이 필요합니다. 검토를 요청할 수 있어요.
            </p>
          )}
          {canManage ? (
            customer.blocked ? (
              <button
                className="seller-button seller-secondary"
                onClick={() =>
                  dispatch({ type: "SET_BLOCK", customerId: customer.id, blocked: false })
                }
              >
                차단 해제
              </button>
            ) : (
              <button
                className="seller-button seller-danger"
                onClick={() => setBlocking(!blocking)}
              >
                고객 차단
              </button>
            )
          ) : (
            <button
              className="seller-button seller-secondary"
              onClick={() => dispatch({ type: "REQUEST_REVIEW", customerId: customer.id })}
            >
              차단 요청
            </button>
          )}
          {blocking && !customer.blocked && (
            <Modal title="차단 사유를 알려주세요." onClose={() => setBlocking(false)}>
              <form
                className="seller-form seller-block-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (reason.trim()) {
                    dispatch({
                      type: "SET_BLOCK",
                      customerId: customer.id,
                      blocked: true,
                      reason: reason.trim(),
                    });
                    setBlocking(false);
                  }
                }}
              >
                <label>
                  차단 사유
                  <textarea
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="관리 기록에 남길 사유를 적어 주세요."
                    required
                    maxLength={300}
                  />
                </label>
                <button className="seller-button seller-danger" disabled={!reason.trim()}>
                  사유를 남기고 차단
                </button>
              </form>
            </Modal>
          )}
        </section>
      </div>
      {quote && <QuoteDetail quote={quote} onClose={() => setQuote(null)} />}
    </Modal>
  );
}

export function CustomersPanel({
  controller,
  initialCustomerId,
  initialSection = "customers",
}: PanelProps & { initialCustomerId?: string | null; initialSection?: "customers" | "abuse" }) {
  const { state, dispatch, canManage } = controller;
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<(typeof KIND_LABELS)[number]>("전체");
  const [status, setStatus] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(initialCustomerId ?? null);
  const [section, setSection] = useState<"customers" | "abuse">(initialSection);
  const [blockOnOpen, setBlockOnOpen] = useState(false);
  useEffect(() => {
    if (initialCustomerId) {
      setSelectedId(initialCustomerId);
      setBlockOnOpen(false);
    }
  }, [initialCustomerId]);
  const selected = state.customers.find((customer) => customer.id === selectedId);
  const filtered = state.customers.filter(
    (customer) =>
      (kind === "전체" || customer.kind === kind) &&
      (status === "all" || customer.blocked === (status === "blocked")) &&
      `${customer.name} ${customer.id}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <div className="seller-page-heading">
        <div>
          <span className="seller-eyebrow">관계가 쌓이는 곳</span>
          <h1>고객 정보</h1>
          <p>고객별 상담과 견적을 이어서 확인하세요.</p>
        </div>
        <span className="seller-soft-label">전체 {state.customers.length}명</span>
      </div>
      <div className="seller-tabs seller-primary-tabs" aria-label="고객 관리 구분">
        <button
          className={section === "customers" ? "seller-active" : ""}
          aria-pressed={section === "customers"}
          onClick={() => setSection("customers")}
        >
          고객별 조회
        </button>
        <button
          className={section === "abuse" ? "seller-active" : ""}
          aria-pressed={section === "abuse"}
          onClick={() => setSection("abuse")}
        >
          악성 사용자 관리{" "}
          <span className="seller-count">
            {state.alerts.filter((alert) => !alert.ignored).length}
          </span>
        </button>
      </div>
      {section === "abuse" && (
        <>
          {state.alerts
            .filter((alert) => !alert.ignored)
            .map((alert) => (
              <div className="seller-abuse-alert" key={alert.id}>
                <span className="seller-alert-icon" aria-hidden="true">
                  !
                </span>
                <div>
                  <strong>욕설 감지 · 담당자 확인이 필요해요</strong>
                  <p>
                    {state.customers.find((customer) => customer.id === alert.customerId)?.name} ·{" "}
                    {alert.text}
                  </p>
                  <small>{alert.time} · 감지 결과를 확인한 후 조치해 주세요.</small>
                </div>
                <div className="seller-alert-actions">
                  <button
                    className="seller-button seller-secondary"
                    onClick={() => {
                      setBlockOnOpen(canManage);
                      setSelectedId(alert.customerId);
                    }}
                  >
                    {canManage ? "차단" : "고객 확인"}
                  </button>
                  {!canManage && (
                    <button
                      className="seller-button seller-secondary"
                      onClick={() =>
                        dispatch({ type: "REQUEST_REVIEW", customerId: alert.customerId })
                      }
                    >
                      차단 요청
                    </button>
                  )}
                  <button
                    className="seller-text-button"
                    onClick={() => dispatch({ type: "IGNORE_ALERT", id: alert.id })}
                  >
                    무시
                  </button>
                </div>
              </div>
            ))}
          {state.alerts.every((alert) => alert.ignored) && (
            <p className="seller-empty">확인이 필요한 욕설 감지 알림이 없습니다.</p>
          )}
          <section className="seller-card">
            <div className="seller-card-heading">
              <div>
                <h2>차단된 고객</h2>
                <p>사유와 처리 이력을 함께 확인해 주세요.</p>
              </div>
              <span className="seller-count">
                {state.customers.filter((customer) => customer.blocked).length}명
              </span>
            </div>
            <div className="seller-table-wrap">
              <table className="seller-table">
                <thead>
                  <tr>
                    <th>고객</th>
                    <th>차단 사유</th>
                    <th>처리자</th>
                    <th>처리 날짜</th>
                    <th>관리</th>
                  </tr>
                </thead>
                <tbody>
                  {state.customers
                    .filter((customer) => customer.blocked)
                    .map((customer) => (
                      <tr key={customer.id}>
                        <td data-label="고객">
                          <strong>{customer.name}</strong>
                          <small>{customer.id}</small>
                        </td>
                        <td data-label="차단 사유">{customer.blockReason}</td>
                        <td data-label="처리자">{customer.blockedBy}</td>
                        <td data-label="처리 날짜">{customer.blockedAt}</td>
                        <td data-label="관리">
                          {canManage ? (
                            <button
                              className="seller-button seller-secondary seller-small"
                              onClick={() =>
                                dispatch({
                                  type: "SET_BLOCK",
                                  customerId: customer.id,
                                  blocked: false,
                                })
                              }
                            >
                              차단 해제
                            </button>
                          ) : (
                            <span className="seller-subtle">관리자 전용</span>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {!state.customers.some((customer) => customer.blocked) && (
              <p className="seller-empty">차단된 고객이 없습니다.</p>
            )}
          </section>
        </>
      )}
      {section === "customers" && (
        <section className="seller-card">
          <div className="seller-table-toolbar">
            <label className="seller-search">
              <span aria-hidden="true">⌕</span>
              <input
                aria-label="고객 검색"
                placeholder="고객 이름 또는 고객 번호 검색"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <select
              aria-label="고객 이용 상태"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="all">모든 이용 상태</option>
              <option value="active">상담 가능</option>
              <option value="blocked">차단됨</option>
            </select>
          </div>
          <div className="seller-tabs" aria-label="고객 유형">
            {KIND_LABELS.map((item) => (
              <button
                key={item}
                className={kind === item ? "seller-active" : ""}
                aria-pressed={kind === item}
                onClick={() => setKind(item)}
              >
                {item}
              </button>
            ))}
          </div>
          <div className="seller-table-wrap">
            <table className="seller-table">
              <thead>
                <tr>
                  <th>고객</th>
                  <th>유형</th>
                  <th>최근 상담</th>
                  <th>견적 수</th>
                  <th>이용 상태</th>
                  <th>
                    <span className="seller-sr-only">상세 보기</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((customer) => (
                  <tr
                    key={customer.id}
                    className="seller-customer-row"
                    onClick={() => {
                      setBlockOnOpen(false);
                      setSelectedId(customer.id);
                    }}
                  >
                    <td data-label="고객">
                      <div className="seller-customer-cell">
                        <span className="seller-avatar seller-avatar-small">
                          {customer.name.slice(0, 1)}
                        </span>
                        <span>
                          <strong>{customer.name}</strong>
                          <small>{customer.id}</small>
                        </span>
                      </div>
                    </td>
                    <td data-label="유형">{customer.kind}</td>
                    <td data-label="최근 상담">{customer.lastConsulted || "상담 전"}</td>
                    <td data-label="견적 수">
                      {state.quotes.filter((quote) => quote.customerId === customer.id).length}건
                    </td>
                    <td data-label="이용 상태">
                      <span
                        className={`seller-label seller-label-${customer.blocked ? "red" : "teal"}`}
                      >
                        {customer.blocked ? "차단됨" : "상담 가능"}
                      </span>
                    </td>
                    <td>
                      <button
                        className="seller-text-button"
                        aria-label={`${customer.name} 상세 보기`}
                        onClick={() => {
                          setBlockOnOpen(false);
                          setSelectedId(customer.id);
                        }}
                      >
                        상세 보기 ↗
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filtered.length === 0 && (
            <p className="seller-empty">
              조건에 맞는 고객이 없습니다. 검색어나 필터를 바꿔 주세요.
            </p>
          )}
          <p className="seller-table-footer">
            총 {filtered.length}명 · 이름과 내역은 모두 시연용 가상 데이터입니다.
          </p>
        </section>
      )}
      {selected && (
        <CustomerDetail
          key={selected.id}
          customer={selected}
          controller={controller}
          onClose={() => setSelectedId(null)}
          initialBlocking={blockOnOpen}
        />
      )}
    </>
  );
}

function IssueDetail({
  issue,
  controller,
  onClose,
}: {
  issue: SellerIssue;
  controller: Controller;
  onClose: () => void;
}) {
  const { state, dispatch } = controller;
  const employees = state.employees.filter((employee) => employee.status === "active");
  const [assignee, setAssignee] = useState(
    employees.some((employee) => employee.name === issue.assignee) ? issue.assignee : "",
  );
  const timeline = issueTimeline(issue);
  return (
    <Modal title="사람 인계 상세" onClose={onClose}>
      <div
        className="seller-issue-detail"
        data-testid={issue.reviewSelections?.length ? "review-selection-handoff-detail" : undefined}
      >
        <div className="seller-badge-row">
          <span className="seller-label seller-label-amber">{issue.kind}</span>
          {issue.dataOrigin && <span className="seller-label seller-label-amber">실제 시연</span>}
          <span className="seller-soft-label">
            {STAGES.find((stage) => stage.value === issue.stage)?.label}
          </span>
        </div>
        <h3>{issue.title}</h3>
        <p className="seller-subtle">
          {issue.dataOrigin
            ? "브라우저 상담 시연"
            : state.customers.find((customer) => customer.id === issue.customerId)?.name}{" "}
          · {issue.id}
        </p>
        <dl>
          <div>
            <dt>상담 요약</dt>
            <dd>{issue.summary}</dd>
          </div>
          <div>
            <dt>처리 제안 · 시연</dt>
            <dd>{issue.suggestion}</dd>
          </div>
          <div>
            <dt>현재 담당자</dt>
            <dd>{issue.assignee || "배정 전"}</dd>
          </div>
        </dl>
        <section className="seller-summary-list">
          <h3>사람의 확인이 필요한 이유</h3>
          <ul>
            {(issue.reasons?.length ? issue.reasons : [issue.summary]).map((reason, index) => (
              <li key={`${index}-${reason}`}>{reason}</li>
            ))}
          </ul>
          {!!issue.reviewSelections?.length && (
            <p className="seller-subtle">
              실제 선택 이력 {issue.reviewSelections.length}건입니다. 경고 확인은 호환성 통과나 검증
              완료를 뜻하지 않습니다.
            </p>
          )}
        </section>
        <section className="seller-chat-history">
          <h3>고객 대화 · 팀 검토 기록</h3>
          <p className="seller-subtle">
            기록 시각순입니다. 시각이 없는 항목은 뒤에 수신 순서대로 표시합니다.
          </p>
          {timeline.length ? (
            timeline.map((entry) => (
              <article
                className={`seller-chat seller-chat-${entry.speaker === "고객" ? "customer" : "agent"}`}
                key={entry.index}
              >
                <small>
                  {entry.kind} ·{" "}
                  {TEAM_LABELS[entry.speaker as keyof typeof TEAM_LABELS] ?? entry.speaker}
                  {" · "}
                  {Number.isNaN(entry.timestamp)
                    ? "시각 미제공"
                    : new Date(entry.timestamp).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}
                </small>
                <p>{entry.text}</p>
              </article>
            ))
          ) : (
            <p className="seller-empty">이 인계에는 대화와 팀 검토 기록이 첨부되지 않았습니다.</p>
          )}
        </section>
        {issue.stage !== "done" && (
          <>
            <label className="seller-field">
              담당자 선택
              <select
                aria-label="담당자 선택"
                value={assignee}
                onChange={(event) => setAssignee(event.target.value)}
              >
                <option value="">담당자를 선택해 주세요</option>
                {employees.map((employee) => (
                  <option key={employee.id} value={employee.name}>
                    {employee.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="seller-modal-actions">
              <button
                className="seller-button seller-secondary"
                disabled={!assignee}
                onClick={() => dispatch({ type: "ASSIGN_ISSUE", id: issue.id, assignee })}
              >
                담당자 지정
              </button>
              <button
                className="seller-button seller-primary"
                disabled={issue.stage !== "working"}
                onClick={() => dispatch({ type: "COMPLETE_ISSUE", id: issue.id })}
              >
                처리 완료
              </button>
            </div>
            <p className="seller-subtle">담당자를 지정한 뒤 처리를 완료할 수 있어요.</p>
          </>
        )}
        {issue.stage === "done" && (
          <p className="seller-success-message">담당자가 처리를 완료한 인계입니다.</p>
        )}
      </div>
    </Modal>
  );
}

export function IssuesPanel({
  controller,
  initialIssueId,
}: PanelProps & { initialIssueId?: string | null }) {
  const { state } = controller;
  const [selectedId, setSelectedId] = useState<string | null>(initialIssueId ?? null);
  useEffect(() => {
    if (initialIssueId) setSelectedId(initialIssueId);
  }, [initialIssueId]);
  const selected = state.issues.find((issue) => issue.id === selectedId);
  return (
    <>
      <div className="seller-page-heading">
        <div>
          <span className="seller-eyebrow">AI가 멈추고 사람에게 연결한 요청</span>
          <h1>사람 인계함</h1>
          <p>인계 이유와 고객 대화, 팀 검토 기록을 확인하고 이어서 처리하세요.</p>
        </div>
        <span className="seller-soft-label">
          가상 {state.issues.filter((issue) => !issue.dataOrigin).length}건 · 실제 시연{" "}
          {state.issues.filter((issue) => issue.dataOrigin).length}건
        </span>
      </div>
      <div className="seller-card seller-issue-counters">
        <span className="seller-soft-label">가상 상담 수치</span>
        <div className="seller-consult-counters">
          <div>
            <span className="seller-dot seller-dot-teal" />
            상담 중<strong key={state.activeConsultations}>{state.activeConsultations}</strong>
          </div>
          <div>
            <span className="seller-dot seller-dot-amber" />
            대기<strong key={state.waitingConsultations}>{state.waitingConsultations}</strong>
          </div>
          <div>
            <span className="seller-dot seller-dot-muted" />
            오늘 완료
            <strong key={state.completedConsultations}>{state.completedConsultations}</strong>
          </div>
        </div>
      </div>
      <div className="seller-kanban">
        {STAGES.map((stage) => {
          const issues = state.issues.filter((issue) => issue.stage === stage.value);
          return (
            <section
              className={`seller-kanban-column seller-stage-${stage.value}`}
              key={stage.value}
            >
              <div className="seller-kanban-heading">
                <h2>{stage.label}</h2>
                <span>{issues.length}</span>
              </div>
              <p>{stage.description}</p>
              <div className="seller-kanban-cards">
                {issues.map((issue) => (
                  <button
                    className="seller-issue-card"
                    data-testid={
                      issue.reviewSelections?.length ? "review-selection-handoff" : undefined
                    }
                    data-consultation-id={issue.consultationId}
                    key={issue.id}
                    onClick={() => setSelectedId(issue.id)}
                  >
                    <span
                      className={`seller-label seller-label-${issue.kind === "오류" ? "red" : issue.kind === "클레임" ? "amber" : "blue"}`}
                    >
                      {issue.kind}
                    </span>
                    {issue.dataOrigin && (
                      <span className="seller-label seller-label-amber">실제 시연</span>
                    )}
                    <strong>{issue.title}</strong>
                    <span className="seller-subtle">
                      {issue.dataOrigin
                        ? "브라우저 상담 시연"
                        : state.customers.find((customer) => customer.id === issue.customerId)
                            ?.name}
                    </span>
                    <span className="seller-issue-card-footer">
                      <span>{issue.assignee || "담당자 미지정"}</span>
                      <span aria-hidden="true">↗</span>
                    </span>
                  </button>
                ))}
                {issues.length === 0 && (
                  <div className="seller-kanban-empty">이 단계의 인계가 없습니다.</div>
                )}
              </div>
            </section>
          );
        })}
      </div>
      {selected && (
        <IssueDetail
          key={selected.id}
          issue={selected}
          controller={controller}
          onClose={() => setSelectedId(null)}
        />
      )}
    </>
  );
}

export function DocumentsPanel({ controller }: PanelProps) {
  const { state, uploadDocument, savePolicy, canManage } = controller;
  const [shipping, setShipping] = useState(String(state.shippingFee));
  const [discount, setDiscount] = useState(String(state.discount));
  const [policyError, setPolicyError] = useState("");
  const [choosingDocument, setChoosingDocument] = useState(false);
  const [documentId, setDocumentId] = useState(state.documents[0]?.id ?? "");
  function submit(event: FormEvent) {
    event.preventDefault();
    const shippingFee = Number(shipping),
      discountRate = Number(discount);
    if (
      !Number.isSafeInteger(shippingFee) ||
      shippingFee < 0 ||
      !Number.isFinite(discountRate) ||
      discountRate < 0 ||
      discountRate > 30
    ) {
      setPolicyError("배송비는 0원 이상, 할인 한도는 0~30%로 입력해 주세요.");
      return;
    }
    setPolicyError("");
    savePolicy(shippingFee, discountRate);
  }
  return (
    <>
      <div className="seller-page-heading">
        <div>
          <span className="seller-eyebrow">상담에 필요한 기준을 한곳에</span>
          <h1>사내 문서 / 정책</h1>
          <p>상품 안내와 판매 정책을 확인하고 관리하세요.</p>
        </div>
        <span className="seller-soft-label">관리자 전용</span>
      </div>
      <div className="seller-documents-grid">
        <section className="seller-card">
          <div className="seller-card-heading">
            <div>
              <h2>상담 참고 문서</h2>
              <p>파일 내용은 읽거나 외부로 전송하지 않습니다.</p>
            </div>
          </div>
          <div className="seller-upload">
            <span aria-hidden="true">↥</span>
            <strong>시연용 문서 업로드</strong>
            <span>가상 문서를 선택하고 업로드 과정을 체험해 보세요.</span>
            <button
              type="button"
              className="seller-button seller-secondary"
              disabled={!canManage || state.uploadProgress !== null}
              onClick={() => setChoosingDocument(true)}
            >
              문서 올리기
            </button>
          </div>
          {state.uploadProgress !== null && (
            <div className="seller-upload-progress" role="status">
              <div>
                <span>시연 업로드 처리 중</span>
                <strong>{state.uploadProgress}%</strong>
              </div>
              <progress value={state.uploadProgress} max={100} />
            </div>
          )}
          <ul className="seller-documents">
            {state.documents.map((document) => (
              <li key={document.id}>
                <span className="seller-document-icon" aria-hidden="true">
                  ▤
                </span>
                <div>
                  <strong>{document.title}</strong>
                  <small>
                    {document.kind} · {document.updatedAt}
                  </small>
                </div>
                <span
                  className={`seller-label seller-label-${document.reflected ? "teal" : "amber"}`}
                >
                  {document.reflected ? "시연 반영됨" : "반영 대기"}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section className="seller-card">
          <div className="seller-card-heading">
            <div>
              <h2>배송 설정과 할인 한도</h2>
              <p>할인 한도는 판매 정책과 같은 값을 사용합니다.</p>
            </div>
          </div>
          <form className="seller-form" onSubmit={submit}>
            <label>
              기본 배송비
              <div className="seller-unit-input">
                <input
                  inputMode="numeric"
                  value={shipping ? Number(shipping).toLocaleString("ko-KR") : ""}
                  onChange={(event) =>
                    setShipping(event.target.value.replace(/\D/g, "").slice(0, 9))
                  }
                  disabled={!canManage}
                  aria-label="기본 배송비"
                />
                <span>원</span>
              </div>
            </label>
            <label>
              할인 자동 응대 한도
              <div className="seller-unit-input">
                <input
                  inputMode="decimal"
                  value={discount}
                  onChange={(event) => setDiscount(event.target.value)}
                  disabled={!canManage}
                  aria-label="기본 할인율"
                />
                <span>%</span>
              </div>
            </label>
            {policyError && (
              <p className="seller-error" role="alert">
                {policyError}
              </p>
            )}
            <p className="seller-demo-note">
              할인 한도는 다음 상담의 사람 인계 판단에 반영됩니다. 배송비는 가상 설정이며 테스트
              부품 단가와 DB를 바꾸지 않습니다.
            </p>
            <button className="seller-button seller-primary" disabled={!canManage}>
              정책 저장 · 시연
            </button>
          </form>
        </section>
      </div>
      {choosingDocument && (
        <Modal title="시연 문서를 선택해 주세요." onClose={() => setChoosingDocument(false)}>
          <div className="seller-form">
            <p className="seller-demo-note">
              파일 선택을 흉내 내는 시연입니다. 실제 파일은 읽거나 업로드하지 않아요.
            </p>
            <label>
              가상 문서
              <select value={documentId} onChange={(event) => setDocumentId(event.target.value)}>
                {state.documents.map((document) => (
                  <option key={document.id} value={document.id}>
                    {document.title} · {document.kind}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="seller-button seller-primary"
              disabled={!documentId}
              onClick={() => {
                const document = state.documents.find((item) => item.id === documentId);
                if (document) {
                  uploadDocument(document.title, document.kind);
                  setChoosingDocument(false);
                }
              }}
            >
              선택한 문서로 시연 업로드
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

export function EmployeesPanel({ controller }: PanelProps) {
  const { state, dispatch, canManage } = controller;
  const labels = { pending: "승인 대기", active: "활성", inactive: "비활성" };
  return (
    <>
      <div className="seller-page-heading">
        <div>
          <span className="seller-eyebrow">함께 일하는 우리 팀</span>
          <h1>직원 관리</h1>
          <p>가입 요청을 승인하고 담당자의 권한을 관리하세요.</p>
        </div>
        <span className="seller-soft-label">관리자 전용</span>
      </div>
      <section className="seller-card">
        <div className="seller-card-heading">
          <div>
            <h2>
              팀원 목록 <span className="seller-count">{state.employees.length}</span>
            </h2>
            <p>모든 계정과 변경 사항은 시연용입니다.</p>
          </div>
          <span className="seller-label seller-label-amber">
            승인 대기 {state.employees.filter((employee) => employee.status === "pending").length}명
          </span>
        </div>
        <div className="seller-table-wrap">
          <table className="seller-table">
            <thead>
              <tr>
                <th>직원</th>
                <th>권한</th>
                <th>상태</th>
                <th>계정 관리</th>
              </tr>
            </thead>
            <tbody>
              {state.employees.map((employee) => (
                <tr key={employee.id}>
                  <td data-label="직원">
                    <div className="seller-customer-cell">
                      <span className="seller-avatar seller-avatar-small">
                        {employee.name.slice(0, 1)}
                      </span>
                      <span>
                        <strong>{employee.name}</strong>
                        <small>{employee.id}</small>
                      </span>
                    </div>
                  </td>
                  <td data-label="권한">
                    <select
                      aria-label={`${employee.name} 권한`}
                      value={employee.role}
                      disabled={!canManage || employee.status !== "active"}
                      onChange={(event) =>
                        dispatch({
                          type: "SET_EMPLOYEE_ROLE",
                          id: employee.id,
                          role: event.target.value as "admin" | "agent",
                        })
                      }
                    >
                      <option value="admin">관리자</option>
                      <option value="agent">상담원</option>
                    </select>
                  </td>
                  <td data-label="상태">
                    <span
                      className={`seller-label seller-label-${employee.status === "active" ? "teal" : employee.status === "pending" ? "amber" : "gray"}`}
                    >
                      {labels[employee.status]}
                    </span>
                  </td>
                  <td data-label="계정 관리">
                    {employee.status === "pending" ? (
                      <button
                        className="seller-button seller-primary seller-small"
                        disabled={!canManage}
                        onClick={() => dispatch({ type: "APPROVE_EMPLOYEE", id: employee.id })}
                      >
                        가입 승인
                      </button>
                    ) : (
                      <button
                        className="seller-button seller-secondary seller-small"
                        disabled={!canManage}
                        onClick={() =>
                          dispatch({
                            type: "SET_EMPLOYEE_STATUS",
                            id: employee.id,
                            status: employee.status === "active" ? "inactive" : "active",
                          })
                        }
                      >
                        {employee.status === "active" ? "비활성화" : "다시 활성화"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

export function SalesPanel({ controller }: PanelProps) {
  return (
    <>
      <div className="seller-page-heading">
        <div>
          <span className="seller-eyebrow">선택의 흐름을 읽다</span>
          <h1>판매 현황</h1>
          <p>상품별 판매와 수요를 비교해 다음 상담을 준비하세요.</p>
        </div>
        <span className="seller-soft-label">가상 데이터</span>
      </div>
      <SalesDashboard
        parts={controller.state.parts}
        todaySales={controller.state.todaySales}
        quotes={controller.state.quotes.length}
      />
    </>
  );
}

export function OfficePanel({
  controller,
  onOpenIssue,
}: PanelProps & { onOpenIssue: (id: string | null) => void }) {
  return (
    <>
      <div className="seller-page-heading">
        <div>
          <span className="seller-eyebrow">업무가 이어지는 공간</span>
          <h1>2D 오피스</h1>
          <p>받은 시연 이벤트에 따라 팀의 상태와 작업 기록을 확인하세요.</p>
        </div>
        <span className="seller-live-tag">
          <i />
          시연 이벤트 연결
        </span>
      </div>
      <div className="seller-office-stage">
        <OfficeBoard state={controller.office} />
      </div>
      <div className="seller-card seller-office-records">
        <div className="seller-card-heading">
          <div>
            <h2>상담 · 이슈 작업 기록</h2>
            <p role="status">{controller.state.office.bubble || "새 요청을 기다리고 있습니다."}</p>
          </div>
          <button
            className="seller-button"
            onClick={() => onOpenIssue(controller.state.office.issueId)}
          >
            처리함에서 보기
          </button>
        </div>
        {controller.state.office.log.length ? (
          <ol className="seller-office-log">
            {controller.state.office.log.map((line, index) => (
              <li key={`${index}-${line}`}>{line}</li>
            ))}
          </ol>
        ) : (
          <p className="seller-muted">아직 받은 작업 기록이 없습니다.</p>
        )}
        <p className="seller-muted">
          기업 시연의 상담·이슈 기록입니다. PC 설계·검증·견적 완료를 의미하지 않습니다.
        </p>
      </div>
    </>
  );
}
