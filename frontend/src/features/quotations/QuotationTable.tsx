import type { Quotation } from "../../api/client";

const won = (value: number) => `${value.toLocaleString("ko-KR")}원`;

export function QuotationTable({ quotation }: { quotation: Quotation | null }) {
  return (
    <section className="panel" aria-label="참고 견적">
      <h2>참고 견적</h2>
      {!quotation ? (
        <p className="muted">견적이 아직 없습니다.</p>
      ) : (
        <>
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
