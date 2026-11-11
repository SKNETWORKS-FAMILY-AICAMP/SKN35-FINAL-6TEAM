import type { Recommendation } from "../../api/client";

const STATUS: Record<string, string> = {
  candidate: "검증 중",
  validated: "검증 통과",
  rejected: "탈락",
};

function price(value: number | null) {
  return value === null ? "가격 미확인" : `${value.toLocaleString("ko-KR")}원`;
}

export function RecommendationList({ items }: { items: Recommendation[] }) {
  return (
    <section className="panel" aria-label="추천 후보">
      <h2>추천 후보</h2>
      {items.length === 0 ? (
        <p className="muted">아직 후보가 없습니다.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>순위</th>
              <th>상품</th>
              <th>가격</th>
              <th>검증</th>
              <th>근거</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => {
              const blocked = r.checks.filter((c) => c.severity === "block" && !c.passed);
              return (
                <tr key={r.id} className={`rec-${r.status}`} data-testid="recommendation">
                  <td>{r.rank}</td>
                  <td>
                    {r.product.brand} {r.product.model_name}
                    <div className="muted mono">
                      {r.product.sku} · {r.product.product_type}
                    </div>
                  </td>
                  <td>{price(r.product.price_amount)}</td>
                  <td>{STATUS[r.status] ?? r.status}</td>
                  <td>
                    <ul className="plain">
                      {(blocked.length ? blocked.map((c) => `✗ ${c.detail}`) : r.reasons).map(
                        (text) => (
                          <li key={text}>{text}</li>
                        ),
                      )}
                    </ul>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
