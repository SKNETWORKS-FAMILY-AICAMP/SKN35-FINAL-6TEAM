/**
 * 참고 견적 표. '인쇄 · PDF 저장' 은 브라우저 인쇄(window.print)로 이 표만 찍습니다 — 인쇄 대화상자에서
 * 'PDF 로 저장' 을 고르면 PDF 가 됩니다(서버에서 PDF 를 만들지 않음). 테스트 데이터 표시는 인쇄본에도 남습니다.
 */
import type { Quotation } from "../../api/client";

const won = (value: number) => `${value.toLocaleString("ko-KR")}원`;

interface Props {
  quotation: Quotation | null;
  companyName?: string;
}

export function QuotationTable({ quotation, companyName }: Props) {
  const isTestData = quotation?.items.some((item) => item.data_status === "test") ?? false;
  const company = companyName ? ` · ${companyName}` : "";
  const today = new Date().toLocaleDateString("ko-KR");
  const printTitle = `BUILDWISE 참고 견적서${company} · 출력일 ${today}`;
  const mark = `참고 견적 · 실제 판매가 아님${isTestData ? " · 테스트 데이터(가상 상품)" : ""}`;

  return (
    <section className="panel print-area" aria-label="참고 견적">
      <header className="panel-head">
        <h2>참고 견적</h2>
        {quotation && (
          <button
            type="button"
            className="print-button no-print"
            onClick={() => window.print()}
            data-testid="print-quotation"
          >
            인쇄 · PDF 저장
          </button>
        )}
      </header>
      {!quotation ? (
        <p className="muted">견적이 아직 없습니다.</p>
      ) : (
        <>
          <p className="print-only">{printTitle}</p>
          <p className="test-mark" data-testid="quotation-test-mark">{mark}</p>
          <table data-testid="quotation">
            <thead>
              <tr>
                <th>상품</th>
                <th>수량</th>
                <th>금액</th>
              </tr>
            </thead>
            <tbody>
              {quotation.items.map((item) => (
                <tr key={item.sku}>
                  <td>
                    {item.brand} {item.model_name}
                  </td>
                  <td>{item.quantity}</td>
                  <td>{won(item.line_total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>할인</td>
                <td>-{won(quotation.discount)}</td>
              </tr>
              <tr>
                <td colSpan={2}>배송비</td>
                <td>{won(quotation.shipping_fee)}</td>
              </tr>
              <tr>
                <th colSpan={2}>합계</th>
                <th data-testid="quotation-total">{won(quotation.total)}</th>
              </tr>
            </tfoot>
          </table>
          <p className="muted">
            요구사항 v{quotation.requirement_version} · 유효기간{" "}
            {new Date(quotation.valid_until).toLocaleDateString("ko-KR")}까지
          </p>
          <ul className="plain notes">
            {quotation.notes.map((note) => (
              <li key={note}>※ {note}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
