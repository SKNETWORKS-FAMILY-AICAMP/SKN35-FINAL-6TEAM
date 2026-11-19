import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Demo } from "./Demo";
import { priceDescription, won, type DemoPart, type DemoView } from "./view";

const part: DemoPart = { id: 1, name: "테스트 모델", category: "gpu", price: 100_000 };

describe("부품 DB 가격 표시", () => {
  it("환산 테스트 가격과 DB 기록일을 함께 표시한다", () => {
    expect(
      priceDescription({
        ...part,
        price_status: "test",
        price_basis: "USD_FX_REFERENCE",
        price_checked_at: "2026-11-19T01:30:00Z",
      }),
    ).toBe("테스트 가격 · 미 달러 환산 · 기록일 2026-11-19");
  });

  it("가격이 없으면 0원으로 표시하지 않는다", () => {
    expect(won(null)).toBe("가격 미등록");
    expect(won(0)).toBe("0원");
  });

  it("출처와 상태가 없으면 미확인으로 표시한다", () => {
    expect(priceDescription(undefined)).toBe("가격 출처 미확인");
    expect(priceDescription(part)).toBe("가격 상태 미확인");
    expect(priceDescription({ ...part, price_status: "confirmed" })).toBe("DB 확인 가격");
  });
});

describe("견적의 예산과 호환 판정", () => {
  const quote: DemoView = {
    csrf: "test",
    revision: 1,
    phase: "quote",
    mode: "upgrade",
    budget: 150000,
    purpose: "게임",
    parts: [{ ...part, price_status: "test", price_basis: "USD_FX_REFERENCE" }],
    categories: ["gpu"],
    owned: {},
    selection: { gpu: 1 },
    category: "",
    candidates: [],
    excluded: [],
    steps: ["gpu"],
    confirmed: ["gpu"],
    lines: [{ id: 1, category: "gpu", name: part.name, price: part.price, quantity: 1 }],
    total: 100000,
    remaining: 50000,
    checks: [
      {
        check_type: "GPU_CLEARANCE",
        result: "PASS",
        reason: "카드 길이가 허용 범위입니다.",
        sources: [{ title: "장착 길이 표", url: "https://example.org/clearance" }],
      },
      { check_type: "PSU_CAPACITY", result: "CONDITIONAL", reason: "일부 전력을 추정했습니다." },
      { check_type: "RAM_QVL", result: "UNKNOWN", reason: "이 조합의 근거가 없습니다." },
    ],
    requires_qvl_consent: true,
    messages: [],
    proposal: null,
    error: "",
    notice: "",
  };

  it("확인이 필요한 견적에도 통과 수, 근거, 예산 잔액과 가격 출처를 함께 표시한다", () => {
    const html = renderToStaticMarkup(createElement(Demo, { view: quote }));
    const balances = html.indexOf("예산 이내 (잔액 50,000원)");
    const acknowledgement = html.indexOf('name="accept_qvl"');
    expect(balances).toBeGreaterThan(0);
    expect(acknowledgement).toBeGreaterThan(balances);
    for (const verdict of ["통과 1개", "조건부 1개", "확인 필요 1개", "탈락 0개"]) {
      expect(html.slice(balances, acknowledgement)).toContain(verdict);
    }
    expect(html.slice(balances, acknowledgement)).toContain('href="https://example.org/clearance"');
    expect(html).toContain("테스트 가격 · 미 달러 환산");
    expect(html.match(/이 조합의 근거가 없습니다\./g)).toHaveLength(1);
  });
});
