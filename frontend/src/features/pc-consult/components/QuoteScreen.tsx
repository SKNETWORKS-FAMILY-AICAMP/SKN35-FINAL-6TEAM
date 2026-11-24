import { useState, type FormEvent } from "react";
import {
  CATEGORY_LABELS,
  itemCount,
  won,
  priceLabel,
  type Category,
  type Quote,
  type SaveReceipt,
} from "../types";
import { Modal, ValidationDetails } from "./ui";
import { PartVisual, type ProductVisualMap } from "./PartVisual";

interface Props {
  quotes: Quote[];
  budget: number;
  pending: boolean;
  error: string | null;
  products?: ProductVisualMap;
  onEdit: (category: Category, color: string, note: string) => void;
  onConfirm: (acceptConditions: boolean) => void;
  onSaved: () => void;
}

export function QuoteScreen({
  quotes,
  budget,
  pending,
  error,
  products = {},
  onEdit,
  onConfirm,
  onSaved,
}: Props) {
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
          <p className="pc-eyebrow">선택한 구성의 견적</p>
          <h1>이 구성이 어떠세요?</h1>
          <p className="pc-muted">선택한 부품과 확인할 내용을 한눈에 살펴보세요.</p>
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
          {quote.status === "CONFIRMED"
            ? "승인 완료"
            : quote.handoff?.required
              ? "담당자 확인 대기"
              : "승인 대기"}
        </span>
      </div>
      {latest.version > 1 && latest.status === "DRAFT" && (
        <p className="pc-warning" role="status">
          구성이 변경되어 다시 승인이 필요합니다. 이전 버전은 이력에 남아 있습니다.
        </p>
      )}
      <div className="pc-quote-table-wrap">
        <div className="pc-quote-document-head">
          <div>
            <p className="pc-eyebrow">견적 · 주문팀</p>
            <h2>고객님을 위한 PC 견적서</h2>
            <span className="pc-muted">선택한 {itemCount(quote)}개 부품을 담았습니다.</span>
          </div>
          <div className="pc-quote-document-amount">
            <span>최종 구성 금액</span>
            <strong>{won(quote.total_amount)}</strong>
            <small>테스트 가격 · 견적 v{quote.version}</small>
          </div>
        </div>
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
            {quote.items.map((item) => {
              const review = quote.reviewItems?.find(
                (entry) => entry.source_key === item.source_key,
              );
              return (
                <tr key={item.source_key}>
                  <td data-label="분류">{CATEGORY_LABELS[item.category]}</td>
                  <td data-label="부품">
                    <div className="pc-quote-product">
                      <PartVisual
                        category={item.category}
                        name={item.part_name_snapshot}
                        imageUrl={products[item.source_key]?.image_url}
                        size="thumbnail"
                      />
                      <div className="pc-quote-product-copy">
                        <small className="pc-quote-category">
                          {!products[item.source_key]?.brand ||
                          /^(unknown|unconfirmed|unverified)$/i.test(
                            products[item.source_key].brand,
                          )
                            ? "브랜드 미확인"
                            : products[item.source_key].brand}
                        </small>
                        <strong>{item.part_name_snapshot}</strong>
                        <small>수량 {item.quantity}개</small>
                        {review && (
                          <div className="pc-quote-item-review" data-testid="pc-quote-item-review">
                            <span className="pc-status pc-status-unknown">확인 필요</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td data-label="가격">
                    <strong>{won(item.unit_price * item.quantity)}</strong>
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
              );
            })}
          </tbody>
        </table>
        {quote.items.some((item) => !products[item.source_key]?.image_url) && (
          <p className="pc-quote-photo-notice">
            제품 사진이 등록되지 않은 부품은 분류별 예시 그림으로 표시합니다.
          </p>
        )}
        <div className="pc-quote-total">
          <span>총 {itemCount(quote)}개 부품</span>
          <strong>{won(quote.total_amount)}</strong>
        </div>
      </div>
      {quote.total_amount <= budget && (
        <p className="pc-footnote">예산 이내 (잔액 {won(budget - quote.total_amount)})</p>
      )}
      {quote.total_amount > budget && (
        <p className="pc-error">전체 예산보다 {won(quote.total_amount - budget)} 초과했습니다.</p>
      )}
      {quote.handoff?.required && (
        <div className="pc-warning" id="pc-quote-handoff" role="status">
          <strong>담당자가 확인해야 하는 견적입니다.</strong>
          <p>기업의 정책에 따라 확인을 마치기 전에는 견적을 확정할 수 없습니다.</p>
          <ul>
            {quote.handoff.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      )}
      {blocked && (
        <p className="pc-warning" role="status">
          {quote.validation.workflow_reason || "구성을 변경한 뒤 다시 확인해 주세요."}
        </p>
      )}
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
      <p className="pc-notice">
        {quote.validation.basis === "demo"
          ? "시연 데이터 견적입니다. 승인 내역은 이 브라우저에만 남고 DB에 기록되지 않습니다."
          : "견적 승인은 현재 상담 세션에만 보관합니다."}
      </p>
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
            disabled={pending || blocked || quote.handoff?.required}
            aria-describedby={quote.handoff?.required ? "pc-quote-handoff" : undefined}
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
          <p className="pc-footnote">
            {latest.validation.basis === "demo"
              ? "시연 데이터 견적을 승인합니다(DB에 기록 안 됨)."
              : "현재 상담 세션에 견적을 승인합니다."}
          </p>
          {latest.validation.status !== "PASS" && (
            <ValidationDetails
              validation={{
                ...latest.validation,
                checks: latest.validation.checks.filter((check) =>
                  ["CONDITIONAL", "UNKNOWN"].includes(check.status),
                ),
              }}
            />
          )}
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
                if (pending || latest.validation.status === "FAIL" || latest.handoff?.required)
                  return;
                setConfirming(false);
                onConfirm(acceptConditions);
              }}
              disabled={
                pending ||
                latest.validation.status === "FAIL" ||
                latest.handoff?.required ||
                (latest.validation.status !== "PASS" && !acceptConditions)
              }
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
  products = {},
  onQuote,
  onPayment,
}: {
  receipt: SaveReceipt;
  products?: ProductVisualMap;
  onQuote: () => void;
  onPayment: () => void;
}) {
  return (
    <section className="pc-success">
      <div className="pc-success-mark" aria-hidden="true">
        ✓
      </div>
      <p className="pc-eyebrow">승인 완료 · 견적 v{receipt.quote.version}</p>
      <h1>선택하신 견적을 승인했어요.</h1>
      <p>{receipt.message}</p>
      <div className="pc-success-parts" aria-label="저장한 구성의 부품 그림">
        {receipt.quote.items.map((item) => (
          <PartVisual
            key={item.source_key}
            category={item.category}
            name={item.part_name_snapshot}
            imageUrl={products[item.source_key]?.image_url}
            size="compact"
          />
        ))}
      </div>
      <div className="pc-success-summary">
        <span>{itemCount(receipt.quote)}개 부품</span>
        <strong>{won(receipt.quote.total_amount)}</strong>
      </div>
      <p className="pc-notice">
        {receipt.storage === "memory"
          ? "시연 저장이라 DB에 기록되지 않습니다. 새로고침하면 내역이 사라집니다."
          : "상담 세션이 끝나면 견적 승인 내역이 만료됩니다."}
      </p>
      <div className="pc-actions">
        <button className="pc-button pc-secondary" onClick={onQuote}>
          견적과 버전 이력 보기
        </button>
        <button className="pc-button pc-primary" onClick={onPayment}>
          결제 화면으로 이동 →
        </button>
      </div>
    </section>
  );
}

export function PaymentScreen({
  receipt,
  products = {},
  onQuote,
  onPay,
}: {
  receipt: SaveReceipt;
  products?: ProductVisualMap;
  onQuote: () => void;
  onPay: () => void;
}) {
  return (
    <section className="pc-payment">
      <p className="pc-eyebrow">승인 완료 · 견적 v{receipt.quote.version}</p>
      <h1>결제할 견적을 확인해 주세요.</h1>
      <p className="pc-muted">
        {receipt.storage === "session"
          ? "승인한 견적은 현재 상담 세션에 보관됩니다. 아래에서 구성과 금액을 확인해 주세요."
          : "시연에서 승인한 견적의 구성과 금액을 확인해 주세요."}
      </p>
      <div className="pc-panel">
        <h2>주문 요약 · 견적 v{receipt.quote.version}</h2>
        <ul className="pc-order-list">
          {receipt.quote.items.map((item) => (
            <li key={item.source_key}>
              <div className="pc-order-product">
                <PartVisual
                  category={item.category}
                  name={item.part_name_snapshot}
                  imageUrl={products[item.source_key]?.image_url}
                  size="compact"
                  caption={false}
                />
                <span>
                  {item.part_name_snapshot}
                  {item.quantity > 1 && ` × ${item.quantity}`}
                </span>
              </div>
              <strong>{won(item.unit_price * item.quantity)}</strong>
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
        <h2>모의 결제</h2>
        <p>시연용으로 실제 금액은 청구되지 않습니다.</p>
      </div>
      <div className="pc-actions pc-bottom-actions">
        <button className="pc-button pc-secondary" onClick={onQuote}>
          견적으로 돌아가기
        </button>
        <button type="button" className="pc-button pc-primary" onClick={onPay}>
          결제하기
        </button>
      </div>
    </section>
  );
}
