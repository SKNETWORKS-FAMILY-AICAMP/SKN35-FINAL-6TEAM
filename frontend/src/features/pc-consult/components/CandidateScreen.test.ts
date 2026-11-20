import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { fixturePart } from "../fixtures/snapshot.fixture";
import type { Candidate, CandidateResult, Quote } from "../types";
import { CandidateScreen } from "./CandidateScreen";
import { QuoteScreen } from "./QuoteScreen";

// Product rows come unchanged from the team's snapshot fixture. These validation outcomes
// exercise presentation states and do not claim actual compatibility for those products.
const unknownReason = "메인보드 저장장치 포트·슬롯 정보가 없어 연결 규격은 별도 확인이 필요합니다.";
const pendingReason = "파워 선택 후 전력 용량을 확인합니다.";
const reviewCandidate: Candidate = {
  part: fixturePart("storage"),
  recommended: true,
  reason: "잘못 전달된 추천 표시도 확인 필요 목록에서는 숨겨야 합니다.",
  validation: {
    basis: "demo",
    status: "UNKNOWN",
    checks: [
      { code: "storage-connection", status: "UNKNOWN", message: unknownReason },
      { code: "storage-missing", status: "UNKNOWN", message: unknownReason },
      { code: "psu", status: "PENDING", message: pendingReason },
    ],
  },
};
const passedCandidate: Candidate = {
  part: fixturePart("cpu"),
  recommended: true,
  reason: "화면 상태 검증용 추천",
  validation: { basis: "demo", status: "PASS", checks: [] },
};
const result: CandidateResult = {
  passed: [],
  needsReview: [reviewCandidate],
  rejectedCount: 0,
  missingColorCount: 0,
  sortLabel: "추천 기준: 취급 브랜드 우선",
  criteria: [],
  basis: "demo",
};

function renderCandidates(overrides: Partial<CandidateResult> = {}) {
  return renderToStaticMarkup(
    createElement(CandidateScreen, {
      category: "storage",
      result: { ...result, ...overrides },
      progress: null,
      pending: false,
      error: null,
      budget: 1000000,
      onChoose: vi.fn(),
      onRetry: vi.fn(),
      onBudget: vi.fn(),
      onBack: vi.fn(),
      onEditSurvey: vi.fn(),
      canBudget: true,
      editing: false,
    }),
  );
}

function quote(status: Quote["status"] = "DRAFT"): Quote {
  const part = reviewCandidate.part;
  return {
    consultation_id: "snapshot-review-screen-test",
    version: 1,
    status,
    currency: "KRW",
    total_amount: part.current_price!,
    created_at: "2026-11-20T00:00:00.000Z",
    items: [
      {
        source_key: part.source_key,
        category: part.category,
        part_name_snapshot: part.name,
        unit_price: part.current_price!,
        quantity: 1,
        price_checked_at: part.price_checked_at,
      },
    ],
    validation: reviewCandidate.validation,
    reviewItems: [
      { source_key: part.source_key, category: part.category, reasons: [unknownReason] },
    ],
  };
}

function renderQuote(value: Quote) {
  return renderToStaticMarkup(
    createElement(QuoteScreen, {
      quotes: [value],
      budget: 1000000,
      pending: false,
      error: null,
      onEdit: vi.fn(),
      onConfirm: vi.fn(),
      onSaved: vi.fn(),
    }),
  );
}

describe("확인 필요 후보와 견적 표시", () => {
  it("통과 후보가 없고 확인 필요 후보가 있으면 빈 상태 대신 목록을 바로 펼칩니다", () => {
    const html = renderCandidates();
    expect(html).toContain("이 단계는 데이터로 확인할 수 없는 항목이 있어요");
    expect(html).toMatch(/<details[^>]*data-testid="pc-unknown"[^>]*open=""/);
    expect(html).toContain(`data-source-key="${reviewCandidate.part.source_key}"`);
    expect(html).not.toContain("현재 조건을 통과한 후보");
    expect(html).not.toContain('class="pc-empty"');
    expect(html).not.toContain("pc-recommendation");
  });

  it("확인 필요 목록의 정렬과 중복 없는 UNKNOWN 사유를 따로 알립니다", () => {
    const html = renderCandidates();
    expect(html).toContain("확인 필요 후보: 가격 낮은 순 · AI 추천 없음");
    expect(html).not.toContain(result.sortLabel);
    const reasons = html.match(/<p[^>]*data-testid="pc-review-reasons"[^>]*>(.*?)<\/p>/)?.[1];
    expect(reasons).toBe(unknownReason);
    expect(reasons).not.toContain(pendingReason);
  });

  it("확인 필요 후보만 있으면 예산 조정과 후보를 정책·인계·기준 안내보다 먼저 보여 줍니다", () => {
    const html = renderCandidates({
      policyLabel: "화면 순서 검증용 기업 정책",
      handoff: { required: true, reasons: ["화면 순서 검증용 인계 사유"] },
      criteria: ["화면 순서 검증용 사양 기준"],
    });
    const candidatePosition = html.indexOf(`data-source-key="${reviewCandidate.part.source_key}"`);
    expect(html.indexOf("확인 필요 후보: 가격 낮은 순 · AI 추천 없음")).toBeLessThan(
      html.indexOf('data-testid="pc-unknown"'),
    );
    expect(html.indexOf("이 부품에 예산 더 쓰기")).toBeLessThan(candidatePosition);
    for (const notice of [
      "화면 순서 검증용 기업 정책",
      "화면 순서 검증용 인계 사유",
      "화면 순서 검증용 사양 기준",
    ]) {
      expect(candidatePosition).toBeLessThan(html.indexOf(notice));
    }
  });

  it("통과 후보가 있으면 추천 하나와 하단의 접힌 확인 필요 목록을 유지합니다", () => {
    const html = renderCandidates({ passed: [passedCandidate] });
    expect(html).toContain("현재 조건을 통과한 후보");
    expect(html).toContain(result.sortLabel);
    expect(html.match(/class="pc-recommendation"/g)).toHaveLength(1);
    expect(html).not.toMatch(/<details[^>]*data-testid="pc-unknown"[^>]*open/);
    expect(html.indexOf(`data-source-key="${passedCandidate.part.source_key}"`)).toBeLessThan(
      html.indexOf('data-testid="pc-unknown"'),
    );
  });

  it("두 목록이 모두 비었을 때만 예산과 조건을 바꾸는 빈 상태를 표시합니다", () => {
    const html = renderCandidates({ needsReview: [] });
    expect(html).toContain("지금 조건에 맞는 후보가 없습니다.");
    expect(html).toContain("예산 다시 나누기");
    expect(html).toContain("설문 조건 바꾸기");
    expect(html).not.toContain('data-testid="pc-unknown"');
  });

  it.each(["DRAFT", "CONFIRMED"] as const)(
    "%s 견적의 부품 행에도 확인 필요 배지와 선택 당시 사유를 남깁니다",
    (status) => {
      const html = renderQuote(quote(status));
      const row = html.match(/<tbody>(.*?)<\/tbody>/)?.[1];
      expect(row).toContain('data-testid="pc-quote-item-review"');
      expect(row).toContain("확인 필요");
      expect(row).toContain(unknownReason);
    },
  );

  it("source_key가 다른 부품에는 확인 필요 메타데이터를 옮겨 붙이지 않습니다", () => {
    const value = quote();
    value.reviewItems = [
      { source_key: fixturePart("cpu").source_key, category: "cpu", reasons: [unknownReason] },
    ];
    expect(renderQuote(value)).not.toContain('data-testid="pc-quote-item-review"');
  });
});
