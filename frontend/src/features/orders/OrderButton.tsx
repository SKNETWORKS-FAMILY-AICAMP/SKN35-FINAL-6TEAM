/**
 * 가상 주문 버튼. 같은 견적에는 같은 Idempotency-Key 를 써서, 두 번 눌러도 주문은 1건입니다.
 */
import { useState } from "react";
import { api, errorMessage, type Order, type Quotation } from "../../api/client";

interface Props {
  companyId: number;
  quotation: Quotation | null;
}

const keys = new Map<string, string>();

function newKey(): string {
  // randomUUID 는 localhost · https 에서만 됩니다. 같은 와이파이의 다른 PC 에서 열면 대체 방식을 씁니다.
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `order-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function keyFor(quotationId: string): string {
  let key = keys.get(quotationId);
  if (!key) {
    key = newKey();
    keys.set(quotationId, key);
  }
  return key;
}

export function OrderButton({ companyId, quotation }: Props) {
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function place() {
    if (!quotation) return;
    setPending(true);
    setError(null);
    const { data, error: failure } = await api.POST("/api/orders", {
      params: {
        header: { "X-Company-Id": companyId, "Idempotency-Key": keyFor(quotation.id) },
      },
      body: { quotation_id: quotation.id },
    });
    setPending(false);
    if (data) setOrder(data);
    else setError(errorMessage(failure));
  }

  const current = order && quotation && order.quotation_id === quotation.id ? order : null;

  return (
    <section className="panel" aria-label="가상 주문">
      <h2>가상 주문</h2>
      <button type="button" onClick={place} disabled={!quotation || pending} data-testid="order">
        이 견적으로 가상 주문
      </button>
      {current && (
        <p data-testid="order-result">
          가상 주문 완료 · <span className="mono">{current.id.slice(0, 8)}</span> ·{" "}
          {current.total.toLocaleString("ko-KR")}원 (실제 결제 없음)
        </p>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
