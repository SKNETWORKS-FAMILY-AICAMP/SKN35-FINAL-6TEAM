import { useState, type FormEvent } from "react";
import {
  CATEGORY_LABELS,
  won,
  priceLabel,
  type Category,
  type ConsultMode,
  type Quote,
  type SaveReceipt,
} from "../types";
import { Modal, StatusBadge, ValidationDetails } from "./ui";

interface Props {
  quotes: Quote[];
  budget: number;
  pending: boolean;
  error: string | null;
  onEdit: (category: Category, color: string, note: string) => void;
  onConfirm: (acceptConditions: boolean) => void;
  onSaved: () => void;
}

export function QuoteScreen({ quotes, budget, pending, error, onEdit, onConfirm, onSaved }: Props) {
  const latest = quotes.at(-1)!;
  const [viewVersion, setViewVersion] = useState(latest.version);
  const [editing, setEditing] = useState<Category | null>(null);
  const [color, setColor] = useState("");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [acceptConditions, setAcceptConditions] = useState(false);
  const quote = quotes.find((item) => item.version === viewVersion) ?? latest;
  const blocked =
    quote.validation.status === "FAIL" ||
    (quote.validation.workflow_status != null && quote.validation.workflow_status !== "completed");
  const isLatest = quote.version === latest.version;
  function edit(event: FormEvent) {
    event.preventDefault();
    if (editing) {
      onEdit(editing, color, note);
      setEditing(null);
    }
  }
  return (
    <section className="pc-quote-screen print-area" aria-label="참고 견적">
      <header className="print-only">
        <h1>BUILDWISE 참고 견적서 · v{quote.version}</h1>
        <p>
          출력일 {new Date().toLocaleDateString("ko-KR")} · 가격은 견적 작성 시점의 카탈로그
          기준입니다.
        </p>
      </header>
      <div className="pc-section-heading no-print">
        <div>
          <p className="pc-eyebrow">YOUR QUOTATION</p>
          <h1>이 구성이 어떠세요?</h1>
          <p className="pc-muted">견적팀이 고른 부품을 한 장에 정리했습니다.</p>
        </div>
        <span className="pc-version">견적 v{quote.version}</span>
        <button
          type="button"
          className="pc-button pc-secondary"
          data-testid="print-quotation"
          onClick={() => window.print()}
        >
          인쇄 · PDF 저장
        </button>
      </div>
      <div className="pc-quote-meta">
        <span>{new Date(quote.created_at).toLocaleString("ko-KR")}</span>
        <span
          className={`pc-status ${quote.status === "CONFIRMED" ? "pc-status-pass" : "pc-status-pending"}`}
        >
          {quote.status === "CONFIRMED" ? "승인 완료" : "승인 대기"}
        </span>
      </div>
      {latest.version > 1 && latest.status === "DRAFT" && (
        <p className="pc-warning" role="status">
          구성이 변경되어 다시 승인이 필요합니다. 이전 버전은 이력에 남아 있습니다.
        </p>
      )}
      <div className="pc-quote-table-wrap">
        <table className="pc-quote-table">
          <caption className="pc-sr-only">견적 v{quote.version} 부품과 가격</caption>
          <thead>
            <tr>
              <th>분류</th>
              <th>선택한 부품</th>
              <th>개별 가격</th>
              <th className="no-print">
                <span className="pc-sr-only">변경 요청</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {quote.items.map((item) => (
              <tr key={item.source_key}>
                <td data-label="분류">{CATEGORY_LABELS[item.category]}</td>
                <td data-label="부품">
                  {item.part_name_snapshot}
                  <small className="print-only">수량 {item.quantity}개</small>
                </td>
                <td data-label="가격">
                  <strong>{won(item.unit_price)}</strong>
                  <small>{priceLabel(item)}</small>
                </td>
                <td className="no-print">
                  {isLatest && (
                    <button
                      className="pc-button pc-secondary pc-small"
                      disabled={pending}
                      onClick={() => {
                        setEditing(item.category);
                        setColor("");
                        setNote("");
                      }}
                      aria-label={`${CATEGORY_LABELS[item.category]} 변경 요청`}
                    >
                      변경 요청
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="pc-quote-total">
          <span>총 {quote.items.length}개 부품</span>
          <strong>{won(quote.total_amount)}</strong>
        </div>
      </div>
      {quote.total_amount <= budget && (
        <p className="pc-footnote">예산 이내 (잔액 {won(budget - quote.total_amount)})</p>
      )}
      {quote.total_amount > budget && (
        <p className="pc-error">전체 예산보다 {won(quote.total_amount - budget)} 초과했습니다.</p>
      )}
      <section className="pc-panel pc-quote-checks">
        <div className="pc-section-heading">
          <h2>승인 전 확인해 주세요.</h2>
          <StatusBadge status={quote.validation.status} />
        </div>
        <p className="pc-muted">
          {(
            [
              ["PASS", "통과"],
              ["CONDITIONAL", "조건부"],
              ["UNKNOWN", "확인 필요"],
              ["FAIL", "탈락"],
            ] as const
          )
            .map(
              ([code, label]) =>
                label +
                " " +
                quote.validation.checks.filter((check) => check.status === code).length +
                "개",
            )
            .join(" · ")}
        </p>
        <ValidationDetails validation={quote.validation} />
        {quote.validation.workflow_reason && (
          <p className={blocked ? "pc-warning" : "pc-footnote"}>
            {quote.validation.workflow_reason}
          </p>
        )}
        {Boolean(quote.validation.citations?.length) && (
          <ul aria-label="견적 검증 근거">
            {quote.validation.citations?.map((citation, index) => {
              const url =
                typeof citation.source_url === "string" && /^https?:\/\//i.test(citation.source_url)
                  ? citation.source_url
                  : null;
              const title =
                typeof citation.source_title === "string"
                  ? citation.source_title
                  : typeof citation.publisher === "string"
                    ? citation.publisher
                    : url;
              return (
                title && (
                  <li key={index}>
                    {url ? (
                      <a href={url} target="_blank" rel="noreferrer">
                        {title}
                      </a>
                    ) : (
                      title
                    )}
                  </li>
                )
              );
            })}
          </ul>
        )}
        <p className="pc-footnote">확인이 필요한 부품은 승인 후에도 확인 사항이 남습니다.</p>
      </section>
      <section className="pc-history no-print">
        <h2>견적 버전 이력</h2>
        <div>
          {quotes.map((version) => (
            <button
              className={`pc-history-item${quote.version === version.version ? " pc-active" : ""}`}
              key={version.version}
              onClick={() => setViewVersion(version.version)}
              aria-pressed={quote.version === version.version}
            >
              <strong>v{version.version}</strong>
              <span>{won(version.total_amount)}</span>
              <small>{version.status === "CONFIRMED" ? "승인 완료" : "작성된 견적"}</small>
            </button>
          ))}
        </div>
      </section>
      {error && (
        <p className="pc-error" role="alert">
          {error}
        </p>
      )}
      <p className="pc-notice">견적 승인은 현재 상담 세션에만 보관합니다.</p>
      <div className="pc-actions pc-bottom-actions no-print">
        <span className="pc-muted">
          {isLatest ? "현재 버전의 구성과 금액을 확인해 주세요." : "이전 버전을 보고 있습니다."}
        </span>
        {!isLatest ? (
          <button className="pc-button pc-primary" onClick={() => setViewVersion(latest.version)}>
            최신 견적 보기
          </button>
        ) : latest.status === "CONFIRMED" ? (
          <button className="pc-button pc-primary" onClick={onSaved}>
            저장 완료 화면
          </button>
        ) : (
          <button
            className="pc-button pc-primary"
            onClick={() => {
              setAcceptConditions(false);
              setConfirming(true);
            }}
            disabled={pending || blocked}
          >
            {pending ? "견적을 저장하고 있습니다…" : "이 견적으로 확정"}
          </button>
        )}
      </div>
      {editing && (
        <Modal title={`${CATEGORY_LABELS[editing]} 변경 요청`} onClose={() => setEditing(null)}>
          <form className="pc-form" onSubmit={edit}>
            <p>현재 구성과 함께 사용할 후보를 다시 찾습니다.</p>
            <label className="pc-field">
              원하는 색상
              <select
                aria-label="원하는 색상"
                value={color}
                onChange={(event) => setColor(event.target.value)}
              >
                <option value="">색상 제한 없음</option>
                <option value="White">흰색</option>
                <option value="Black">검은색</option>
                <option value="Silver">은색</option>
              </select>
            </label>
            <label className="pc-field">
              바라는 조건
              <textarea
                aria-label="바라는 조건"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="예: 흰색 케이스를 원합니다."
                maxLength={500}
              />
            </label>
            <p className="pc-footnote">
              선택한 색상을 필터에 반영합니다. 자유 입력은 요청 메모로 전달하며, 성능 등을 자동
              판정하지 않습니다.
            </p>
            <div className="pc-actions">
              <button
                className="pc-button pc-secondary"
                type="button"
                onClick={() => setEditing(null)}
              >
                취소
              </button>
              <button className="pc-button pc-primary">설계팀에 변경 요청</button>
            </div>
          </form>
        </Modal>
      )}
      {confirming && (
        <Modal title={`견적 v${latest.version}을 확정할까요?`} onClose={() => setConfirming(false)}>
          <p>총 {latest.items.length}개 부품을 승인합니다.</p>
          <strong className="pc-confirm-total">{won(latest.total_amount)}</strong>
          <p className="pc-footnote">현재 상담 세션에 견적을 승인합니다.</p>
          {latest.validation.status !== "PASS" && (
            <p className="pc-warning">
              <label>
                <input
                  type="checkbox"
                  checked={acceptConditions}
                  onChange={(event) => setAcceptConditions(event.target.checked)}
                />{" "}
                조건부 또는 확인 불가 항목을 확인했으며 이 조건으로 견적을 승인합니다.
              </label>
            </p>
          )}
          <div className="pc-actions">
            <button className="pc-button pc-secondary" onClick={() => setConfirming(false)}>
              돌아가기
            </button>
            <button
              className="pc-button pc-primary"
              onClick={() => {
                setConfirming(false);
                onConfirm(acceptConditions);
              }}
              disabled={pending || (latest.validation.status !== "PASS" && !acceptConditions)}
            >
              확인하고 견적 승인
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

export function SavedScreen({
  receipt,
  mode,
  onQuote,
  onPayment,
}: {
  receipt: SaveReceipt;
  mode: ConsultMode;
  onQuote: () => void;
  onPayment: () => void;
}) {
  return (
    <section className="pc-success">
      <div className="pc-success-mark" aria-hidden="true">
        ✓
      </div>
      <p className="pc-eyebrow">CONFIRMED · V{receipt.quote.version}</p>
      <h1>선택하신 견적을 승인했어요.</h1>
      <p>{receipt.message}</p>
      <div className="pc-success-summary">
        <span>{receipt.quote.items.length}개 부품</span>
        <strong>{won(receipt.quote.total_amount)}</strong>
      </div>
      <p className="pc-notice">상담 세션이 끝나면 견적 승인 내역이 만료됩니다.</p>
      <div className="pc-actions">
        <button className="pc-button pc-secondary" onClick={onQuote}>
          견적과 버전 이력 보기
        </button>
        {mode === "replacement" && (
          <button className="pc-button pc-primary" onClick={onPayment}>
            결제 안내로 이동 →
          </button>
        )}
      </div>
    </section>
  );
}

export function PaymentScreen({ receipt, onQuote }: { receipt: SaveReceipt; onQuote: () => void }) {
  return (
    <section className="pc-payment">
      <p className="pc-eyebrow">NEXT STEP</p>
      <h1>결제 연동을 준비하고 있어요.</h1>
      <p className="pc-muted">
        저장한 견적을 확인해 주세요. 현재 실제 주문이나 결제는 진행되지 않습니다.
      </p>
      <div className="pc-panel">
        <h2>주문 요약 · 견적 v{receipt.quote.version}</h2>
        <ul className="pc-order-list">
          {receipt.quote.items.map((item) => (
            <li key={item.source_key}>
              <span>{item.part_name_snapshot}</span>
              <strong>{won(item.unit_price)}</strong>
            </li>
          ))}
        </ul>
        <div className="pc-quote-total">
          <span>합계</span>
          <strong>{won(receipt.quote.total_amount)}</strong>
        </div>
      </div>
      <div className="pc-payment-placeholder">
        <span aria-hidden="true">▤</span>
        <h2>결제 연동 예정</h2>
        <p>결제 수단과 개인정보를 입력하지 않습니다.</p>
      </div>
      <div className="pc-actions pc-bottom-actions">
        <button className="pc-button pc-secondary" onClick={onQuote}>
          견적으로 돌아가기
        </button>
      </div>
    </section>
  );
}
