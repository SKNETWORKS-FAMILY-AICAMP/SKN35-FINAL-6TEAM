import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  CATEGORY_LABEL,
  priceDescription,
  won,
  type DemoPart,
  type DemoView,
  type Mode,
} from "./view";
import "./demo.css";

const STAGES = ["사전 설문", "부품 선택", "견적 확인", "모의 결제"];
const STAGE_INDEX = { survey: 0, consult: 1, selection: 1, quote: 2, payment: 3 };
const CHECK_LABEL: Record<string, string> = {
  CPU_SUPPORT: "CPU 지원",
  RAM_TYPE: "메모리 규격",
  RAM_FORM_FACTOR: "메모리 형태",
  RAM_SLOTS: "메모리 슬롯",
  RAM_CAPACITY: "메모리 용량",
  RAM_QVL: "메모리 호환 목록",
  GPU_CLEARANCE: "GPU 장착 공간",
  PSU_CAPACITY: "파워 용량",
  BOARD_CASE: "케이스의 메인보드 규격",
  COOLER_SOCKET: "쿨러 장착 소켓",
  COOLER_CLEARANCE: "쿨러 장착 공간",
  COOLER_POWER: "쿨러 냉각 용량",
  STORAGE_INTERFACE: "저장장치 연결 규격",
  PSU_CASE: "케이스의 파워 규격",
};
const RESULT_LABEL: Record<string, string> = {
  PASS: "통과",
  CONDITIONAL: "조건부",
  UNKNOWN: "확인 필요",
  FAIL: "탈락",
};

function Form({
  view,
  action,
  children,
  className,
  destination = "/",
}: {
  view: DemoView;
  action: string;
  children: ReactNode;
  className?: string;
  destination?: string;
}) {
  return (
    <form method="post" action={destination} className={className}>
      <input type="hidden" name="csrf" value={view.csrf} />
      <input type="hidden" name="revision" value={view.revision} />
      <input type="hidden" name="action" value={action} />
      {children}
    </form>
  );
}

function Survey({ view }: { view: DemoView }) {
  const [mode, setMode] = useState<Mode>(view.mode === "new" ? "new" : "upgrade");
  const [budgets, setBudgets] = useState({
    upgrade: String(view.suggested_budgets?.upgrade ?? ""),
    new: String(view.suggested_budgets?.new ?? ""),
  });
  const [purpose, setPurpose] = useState(view.purpose || "고성능 게임");
  const [question, setQuestion] = useState("");
  return (
    <Form view={view} action="start" className="bw-survey">
      <section className="bw-surface">
        <h2>어떤 상담이 필요한가요?</h2>
        <fieldset className="bw-mode">
          <legend className="bw-sr">상담 유형</legend>
          {(["upgrade", "new"] as const).map((value) => (
            <label className={mode === value ? "is-on" : ""} key={value}>
              <input
                type="radio"
                name="mode"
                value={value}
                checked={mode === value}
                onChange={() => setMode(value)}
              />
              <span>
                <strong>{value === "upgrade" ? "부품 교체" : "신규 조립"}</strong>
                <small>
                  {value === "upgrade" ? "지금 쓰는 PC 업그레이드" : "처음부터 PC 구성"}
                </small>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="bw-fields">
          <label>
            사용 목적
            <input
              name="purpose"
              maxLength={180}
              required
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              list="bw-purposes"
            />
          </label>
          <datalist id="bw-purposes">
            <option>고성능 게임</option>
            <option>영상 편집</option>
            <option>이미지 편집</option>
            <option>사무 작업</option>
          </datalist>
          <label>
            {mode === "upgrade" ? "교체 예산" : "전체 조립 예산"}
            <span className="bw-money-input">
              <input
                type="number"
                name="budget"
                min="1"
                max="1000000000"
                step="1"
                required
                value={budgets[mode]}
                onChange={(e) => setBudgets({ ...budgets, [mode]: e.target.value })}
              />
              <span>원</span>
            </span>
          </label>
        </div>
        <label className="bw-field">
          상담 내용 <small>선택</small>
          <textarea
            name="question"
            rows={3}
            maxLength={500}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={
              mode === "upgrade"
                ? "예: 게임이 끊겨요. GPU와 메모리를 살펴봐 주세요."
                : "예: 영상 편집용 PC를 구성하고 싶어요."
            }
          />
        </label>
      </section>
      {mode === "upgrade" && (
        <section className="bw-surface">
          <h2>현재 보유한 부품</h2>
          <p className="bw-description">
            선택한 부품으로 호환성을 확인합니다. 견적에는 새로 구매하는 부품만 포함됩니다.
          </p>
          <div className="bw-fields">
            {view.categories.map((category) => (
              <label key={category}>
                {CATEGORY_LABEL[category] ?? category}
                <select
                  name={"owned_" + category}
                  required
                  defaultValue={String(view.owned[category] ?? "")}
                >
                  <option value="" disabled>
                    모델 선택
                  </option>
                  {view.parts
                    .filter((item) => item.category === category)
                    .map((item) => (
                      <option value={item.id} key={item.id}>
                        {item.name}
                      </option>
                    ))}
                </select>
              </label>
            ))}
          </div>
        </section>
      )}
      <div className="bw-actions">
        <button className="bw-primary" type="submit">
          설문 제출하고 상담 시작
        </button>
      </div>
    </Form>
  );
}

function specLine(part?: DemoPart) {
  const specs = part?.specs;
  if (!specs) return "";
  const items: string[] = [];
  if (typeof specs.cores === "number") items.push(specs.cores + "코어");
  if (typeof specs.vram_gb === "number") items.push("VRAM " + specs.vram_gb + "GB");
  if (typeof specs.capacity_gb === "number") items.push(specs.capacity_gb + "GB");
  if (typeof specs.ram_type === "string") items.push(specs.ram_type);
  if (typeof specs.wattage_w === "number") items.push(specs.wattage_w + "W");
  if (typeof specs.length_mm === "number") items.push("길이 " + specs.length_mm + "mm");
  const color = Array.isArray(specs.color) ? specs.color.join(" / ") : specs.color;
  if (typeof color === "string" && color !== "") {
    const colors: Record<string, string> = { white: "화이트", black: "블랙" };
    items.push(colors[color.toLowerCase()] ?? color);
  }
  return items.join(" · ");
}

function Candidates({ view }: { view: DemoView }) {
  return (
    <section className="bw-surface">
      <h2>{CATEGORY_LABEL[view.category] ?? "부품"} 후보 선택</h2>
      <p className="bw-description">
        설계팀이 고른 후보를 검증 규칙과 예산으로 비교했습니다. 상담팀에 선택 이유를 물어볼 수
        있습니다.
      </p>
      {view.candidates.length === 0 ? (
        <p className="bw-description">현재 조건에서 선택할 수 있는 후보가 없습니다.</p>
      ) : (
        <div className="bw-candidates">
          {view.candidates.map((item) => {
            const highlight = item.recommended === true && item.validated === true;
            const part = view.parts.find((row) => String(row.id) === String(item.id));
            const spec = specLine(part);
            return (
              <div key={item.id} className={"bw-candidate" + (highlight ? " is-recommended" : "")}>
                <div className="bw-candidate-info">
                  {highlight && (
                    <span className="bw-pick">
                      {view.mode === "new" ? "용도·예산 추천" : "AI 추천 · 통과 후보 중 최저가"}
                    </span>
                  )}
                  <h3>{item.name}</h3>
                  {spec && <small>{spec}</small>}
                  <small className="bw-price-description">{priceDescription(part)}</small>
                  {item.conditional && <strong className="bw-check-pending">호환 확인 필요</strong>}
                  {item.reason && <p>{item.reason}</p>}
                </div>
                <div className="bw-purchase">
                  <strong>{won(item.price)}</strong>
                  <Form view={view} action="choose">
                    <input type="hidden" name="part_id" value={item.id} />
                    <button type="submit" className="bw-secondary" aria-label={item.name + " 선택"}>
                      선택
                    </button>
                  </Form>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {view.excluded.length > 0 && (
        <details className="bw-exclusions">
          <summary>제외된 후보와 이유 {view.excluded.length}개</summary>
          {view.excluded.map((item) => (
            <p key={item.id}>
              <strong>{item.name}</strong> · {item.reason}
            </p>
          ))}
        </details>
      )}
    </section>
  );
}

function Checks({ view }: { view: DemoView }) {
  if (!view.checks.length) return null;
  const inQuote = view.phase === "quote" || view.phase === "payment";
  return (
    <details className={inQuote ? "bw-quote-checks bw-checks" : "bw-surface bw-checks"}>
      <summary>
        현재 구성의 호환성 검사 <span>{view.checks.length}개 · 항목별 근거 보기</span>
        <span className="bw-verdict-counts">
          {Object.entries(RESULT_LABEL).map(([result, label]) => (
            <span key={result} className={"bw-status-" + result.toLowerCase()}>
              {label} {view.checks.filter((check) => check.result === result).length}개
            </span>
          ))}
        </span>
      </summary>
      <ul>
        {view.checks.map((check, i) => (
          <li key={check.check_type + i}>
            <div>
              <strong>{CHECK_LABEL[check.check_type] ?? check.check_type}</strong>
              <span className={check.result === "PASS" ? "pass" : "attention"}>
                {RESULT_LABEL[check.result] ?? check.result}
              </span>
            </div>
            <p>{check.reason}</p>
            {check.sources
              ?.filter((source) => /^https?:\/\//i.test(source.url))
              .map((source) => (
                <a
                  className="bw-check-source"
                  href={source.url}
                  key={source.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {source.title} ↗
                </a>
              ))}
          </li>
        ))}
      </ul>
    </details>
  );
}

function Chat({ view }: { view: DemoView }) {
  return (
    <section className="bw-surface bw-chat" id="bw-chat">
      <h2>상담 내역</h2>
      {view.messages.map((message, i) => (
        <article
          key={i}
          id={i === view.messages.length - 1 ? "bw-last-message" : undefined}
          className={"bw-message" + (message.role === "user" ? " from-user" : "")}
        >
          <div className="bw-author">
            {message.role === "user" ? "나" : message.role === "system" ? "시스템" : "상담팀"}
            {message.model && <small>{message.model}</small>}
          </div>
          <p>{message.text}</p>
          {!!message.sources?.length && (
            <details>
              <summary>답변 근거 {message.sources.length}개</summary>
              {message.sources.map((source, j) => (
                <div className="bw-source" key={source.url + j}>
                  {/^https?:\/\//i.test(source.url) ? (
                    <a href={source.url} target="_blank" rel="noreferrer">
                      {source.title} ↗
                    </a>
                  ) : (
                    <strong>{source.title}</strong>
                  )}
                  {source.text && <p>{source.text}</p>}
                </div>
              ))}
            </details>
          )}
        </article>
      ))}
      {view.mode === "new" && view.phase === "quote" && !view.proposal && (
        <div className="bw-suggestions">
          {["GPU에 예산을 더 쓰고 싶어요", "케이스를 화이트로 바꿔 줘"].map((question) => (
            <Form key={question} view={view} action="chat">
              <input type="hidden" name="question" value={question} />
              <button type="submit" className="bw-chip">
                {question}
              </button>
            </Form>
          ))}
        </div>
      )}
      <Form view={view} action="chat" className="bw-compose">
        <label className="bw-field">
          추가 질문 또는 변경 요청
          <textarea
            name="question"
            rows={2}
            maxLength={500}
            required
            placeholder="예: GPU에 예산을 더 쓰고 싶어요."
          />
        </label>
        <button type="submit" className="bw-secondary">
          보내기
        </button>
      </Form>
    </section>
  );
}

function ProposedChange({ view }: { view: DemoView }) {
  const proposal = view.proposal;
  if (!proposal) return null;
  return (
    <section className="bw-surface bw-proposal">
      <h2>구성 변경 제안</h2>
      <p>{proposal.description}</p>
      <ul>
        {proposal.changes.map((change) => (
          <li key={change.category}>
            <strong>{CATEGORY_LABEL[change.category] ?? change.category}</strong>
            <span>
              {change.old_name} → {change.new_name}
            </span>
            <b>
              {change.delta > 0 ? "+" : ""}
              {won(change.delta)}
            </b>
          </li>
        ))}
      </ul>
      <p className="bw-total-row">
        변경 후 총액 <strong>{won(proposal.total)}</strong>
      </p>
      <div className="bw-actions">
        <Form view={view} action="apply">
          <button type="submit" className="bw-primary">
            제안 적용
          </button>
        </Form>
        <Form view={view} action="dismiss">
          <button type="submit" className="bw-secondary">
            기존 구성 유지
          </button>
        </Form>
      </div>
    </section>
  );
}

function Quote({ view }: { view: DemoView }) {
  const paid = view.phase === "payment";
  const pricesComplete = view.lines.length > 0 && view.lines.every((line) => line.price != null);
  return (
    <section className="bw-surface">
      <h2>{paid ? "승인한 견적" : "최종 견적서"}</h2>
      <div className="bw-quote-lines">
        {view.lines.map((line) => (
          <div key={line.id} className="bw-quote-line">
            <div>
              <small>{CATEGORY_LABEL[line.category] ?? line.category}</small>
              <strong>{line.name}</strong>
              <small>
                {line.quantity}개 × {won(line.price)}
              </small>
              <small>
                {priceDescription(view.parts.find((part) => String(part.id) === String(line.id)))}
              </small>
            </div>
            <div>
              <b>{won(line.price == null ? null : line.price * line.quantity)}</b>
              {!paid && (
                <Form view={view} action="revise">
                  <input type="hidden" name="category" value={line.category} />
                  <button type="submit" className="bw-text">
                    부품 변경
                  </button>
                </Form>
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="bw-total-row">
        DB 기준 구매 합계<strong>{pricesComplete ? won(view.total) : "가격 확인 필요"}</strong>
      </p>
      <p className="bw-quote-budget">
        예산 {won(view.budget)} ·{" "}
        {pricesComplete
          ? view.remaining >= 0
            ? `예산 이내 (잔액 ${won(view.remaining)})`
            : `예산 ${won(-view.remaining)} 초과`
          : "미등록 가격 확인 후 합계 비교 가능"}
      </p>
      <Checks view={view} />
      {paid ? (
        <p className="bw-description">승인한 시연 견적입니다. 실제 청구 금액은 없습니다.</p>
      ) : (
        <Form view={view} action="approve">
          {view.requires_qvl_consent && (
            <div className="bw-qvl">
              <label>
                <input type="checkbox" name="accept_qvl" value="1" required /> 조건부·확인 필요
                항목을 확인했으며 참고 견적을 승인합니다.
              </label>
            </div>
          )}
          <button
            className="bw-primary"
            type="submit"
            disabled={!!view.proposal || view.lines.length === 0}
          >
            견적 승인 · 모의 결제로 이동
          </button>
        </Form>
      )}
    </section>
  );
}

function Summary({ view }: { view: DemoView }) {
  return (
    <aside className="bw-summary" aria-label="현재 구성 요약">
      <h2>{view.phase === "survey" ? "상담 진행 순서" : "현재 구성"}</h2>
      {view.phase === "survey" ? (
        <ol className="bw-guide">
          <li>
            <strong>설문 작성</strong>
            <p>사용 목적과 예산, 보유한 부품을 알려주세요.</p>
          </li>
          <li>
            <strong>추천 비교</strong>
            <p>호환성과 가격을 확인하고 부품을 선택하세요.</p>
          </li>
          <li>
            <strong>견적 확인</strong>
            <p>구성을 조정하고 최종 구매 목록을 확인하세요.</p>
          </li>
        </ol>
      ) : (
        <>
          <p className="bw-summary-mode">
            {view.mode === "upgrade" ? "부품 교체" : "신규 조립"} · {view.purpose}
          </p>
          <dl className="bw-balances">
            <div>
              <dt>예산</dt>
              <dd>{won(view.budget)}</dd>
            </div>
            <div>
              <dt>
                {view.mode === "new" && view.phase === "selection" ? "예상 구성 금액" : "선택 금액"}
              </dt>
              <dd>{won(view.total)}</dd>
            </div>
            <div>
              <dt>남은 예산</dt>
              <dd>{won(view.remaining)}</dd>
            </div>
          </dl>
          <ul className="bw-basket">
            {view.lines.map((line) => (
              <li key={line.id}>
                <small>
                  {CATEGORY_LABEL[line.category] ?? line.category}
                  {view.mode === "new" &&
                    view.phase === "selection" &&
                    (view.confirmed.includes(line.category) ? " · 선택 완료" : " · 구성안")}
                </small>
                <span>{line.name}</span>
              </li>
            ))}
          </ul>
          {view.phase === "selection" && view.category === "" && !view.proposal && (
            <Form view={view} action="quote">
              <button type="submit" className="bw-secondary">
                견적서 확인
              </button>
            </Form>
          )}
        </>
      )}
      <p className="bw-data-note">
        BUILDWISE 부품 DB에서 추린 {view.parts.length}개 모델을 비교합니다. 환산 테스트 가격은 예산
        비교용입니다.
      </p>
    </aside>
  );
}

export function Demo({ view }: { view: DemoView }) {
  const idx = STAGE_INDEX[view.phase];
  const [confirmReset, setConfirmReset] = useState(false);
  const [pending, setPending] = useState(false);
  const submitted = useRef(false);
  useEffect(() => {
    const restored = () => {
      submitted.current = false;
      setPending(false);
    };
    window.addEventListener("pageshow", restored);
    return () => window.removeEventListener("pageshow", restored);
  }, []);
  return (
    <div
      className="bw-demo"
      aria-busy={pending}
      onSubmitCapture={(event) => {
        if (submitted.current) {
          event.preventDefault();
          return;
        }
        submitted.current = true;
        setPending(true);
      }}
    >
      <header className="bw-brandbar">
        <div>
          <span className="bw-brand">BUILDWISE</span>
          <span>PC 상담</span>
        </div>
        {view.phase !== "survey" &&
          (confirmReset ? (
            <div>
              <span>현재 상담을 종료할까요?</span>
              <Form view={view} action="reset">
                <button className="bw-text" type="submit">
                  새로 시작
                </button>
              </Form>
              <button className="bw-text" onClick={() => setConfirmReset(false)}>
                취소
              </button>
            </div>
          ) : (
            <button className="bw-text" onClick={() => setConfirmReset(true)}>
              새 상담
            </button>
          ))}
      </header>
      <main className="bw-main">
        <nav aria-label="상담 진행 단계">
          <ol className="bw-steps">
            {STAGES.map((stage, i) => (
              <li
                key={stage}
                aria-current={i === idx ? "step" : undefined}
                className={i === idx ? "active" : i < idx ? "done" : ""}
              >
                {stage}
              </li>
            ))}
          </ol>
        </nav>
        <h1>
          {view.phase === "consult"
            ? "현재 구성 상담"
            : ["PC 맞춤 상담", "부품을 선택하세요", "견적을 확인하세요", "모의 결제"][idx]}
        </h1>
        <p className="bw-lead">
          {view.phase === "consult"
            ? "상담 내역을 확인하고 필요한 변경을 요청하세요."
            : [
                "교체할 부품을 찾거나 새 PC의 구성을 시작하세요.",
                "예산과 호환 조건에 맞는 후보를 비교하세요.",
                "구매 목록을 확인하거나 상담팀에 변경을 요청하세요.",
                "승인한 구성과 금액을 확인하세요.",
              ][idx]}
        </p>
        {view.phase !== "survey" && view.phase !== "payment" && (
          <div className="bw-ask-bar">
            <a href="#bw-chat">상담 내역 보기</a>
            <Form view={view} action="chat" destination="/#bw-last-message">
              <input
                type="hidden"
                name="question"
                value="Crucial CB16GU4800과 CB16GS4800 중 노트북용은 어느 쪽인가요? 제조사 문서로 설명해 주세요."
              />
              <button type="submit" className="bw-chip">
                문서로 질문하기 · Crucial 노트북용 메모리
              </button>
            </Form>
          </div>
        )}
        {pending && (
          <p className="bw-pending" role="status">
            요청을 처리하고 있습니다…
          </p>
        )}
        {view.error && (
          <div role="alert" className="bw-alert">
            <span>{view.error}</span>
            {view.can_retry && (
              <Form view={view} action="retry">
                <button type="submit" className="bw-secondary">
                  답변 다시 요청
                </button>
              </Form>
            )}
          </div>
        )}
        {view.notice && (
          <p role="status" className="bw-notice">
            {view.notice}
          </p>
        )}
        <div className="bw-layout">
          <div className="bw-work">
            {view.phase === "survey" ? (
              <Survey view={view} />
            ) : (
              <>
                <ProposedChange view={view} />
                {view.phase === "selection" && view.category && <Candidates view={view} />}
                {(view.phase === "quote" || view.phase === "payment") && <Quote view={view} />}
                {view.phase !== "quote" && view.phase !== "payment" && <Checks view={view} />}
                {view.phase !== "payment" && <Chat view={view} />}
              </>
            )}
          </div>
          <Summary view={view} />
        </div>
      </main>
    </div>
  );
}
