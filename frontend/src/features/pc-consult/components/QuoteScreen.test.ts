import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { it, expect } from "vitest";
import type { Quote } from "../types";
import { QuoteScreen } from "./QuoteScreen";

const quote: Quote = {
  consultation_id: "test-session",
  quote_id: "test-draft",
  version: 1,
  status: "DRAFT",
  total_amount: 100000,
  currency: "KRW",
  created_at: "2026-11-19T01:30:00Z",
  items: [
    {
      part_id: 1,
      source_key: "test-part",
      category: "gpu",
      part_name_snapshot: "테스트 모델",
      unit_price: 100000,
      quantity: 1,
      price_status: "test",
      price_basis: "USD_FX_REFERENCE",
      price_checked_at: "2026-11-19T01:30:00Z",
    },
  ],
  validation: {
    basis: "api",
    status: "UNKNOWN",
    workflow_status: "needs_input",
    workflow_reason: "검증 근거가 더 필요합니다.",
    checks: [
      {
        code: "GPU_CLEARANCE",
        status: "PASS",
        message: "카드 길이가 허용 범위입니다.",
        sources: [{ title: "장착 길이 표", url: "https://example.org/clearance" }],
      },
      { code: "PSU_CAPACITY", status: "CONDITIONAL", message: "일부 전력을 추정했습니다." },
      { code: "RAM_QVL", status: "UNKNOWN", message: "이 조합의 근거가 없습니다." },
    ],
    citations: [{ source_title: "호환 목록", source_url: "https://example.org/qvl" }],
  },
};

it("shows the budget and blocking reason without listing technical checks on the quote", () => {
  const html = renderToStaticMarkup(
    createElement(QuoteScreen, {
      quotes: [quote],
      budget: 150000,
      error: null,
      pending: false,
      onConfirm() {},
      onEdit() {},
      onSaved() {},
    }),
  );
  expect(html).toContain('data-testid="print-quotation"');
  expect(html).toContain("BUILDWISE 참고 견적서 · v1");
  expect(html).toContain("가격은 견적 작성 시점의 카탈로그 기준");
  expect(html).toContain("예산 이내 (잔액 ₩50,000)");
  for (const verdict of ["통과 1개", "조건부 1개", "확인 필요 1개", "탈락 0개"])
    expect(html).not.toContain(verdict);
  expect(html).not.toContain('href="https://example.org/clearance"');
  expect(html).not.toContain('href="https://example.org/qvl"');
  expect(html).toContain("테스트 가격 · 미 달러 환산 · 기록일 2026-11-19");
  expect(html).toContain("검증 근거가 더 필요합니다.");
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>이 견적으로 확정/);
});
