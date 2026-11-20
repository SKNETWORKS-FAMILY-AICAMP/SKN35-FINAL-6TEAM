import { describe, expect, it } from "vitest";
import { fixtureParts, fixtureRecords } from "./fixtures/snapshot.fixture";
import { reviewCase } from "./fixtures/review.snapshot.fixture";
import { createSnapshotSource } from "./data/snapshotSource";
import { DEFAULT_COMPANY_POLICIES } from "./data/companyPolicy";
import { finishCandidates } from "./data/demoRules";
import {
  consultReducer,
  currentCategory,
  currentQuote,
  initialConsultState,
  isSelectionComplete,
} from "./state";
import { CATEGORIES, type Candidate, type Survey } from "./types";

// All product/evidence rows come from the read-only snapshot fixtures above.
const survey: Survey = {
  mode: "new",
  budget: 5000000,
  purposes: ["gaming"],
  resolution: "fhd",
  frameRate: "60",
  workScale: "basic",
  problems: [],
  problemNote: "",
  owned: {},
};
const pickedKeys = [
  "amd-ryzen-5-7600",
  "mb-asus-tuf-gaming-b850-plus-wifi",
  "ram-gskill-f5-6000j3636f32gx2-fx5",
  "gpu-msi-3060-ventus-2x-12g",
  "docyx:f05d1550ae36444134bdf29a0b110a125c3313cf77b77793d46a1d582a5877a3",
  "docyx:3766b428ae8431bc24dc3684295226f3ebdd0e33fc32022814be84453a455ea3",
  "docyx:5f4cbd8dce220c209ba0c26b04120fb561d84facb4720a7f4c10b13825d92858",
  reviewCase.source_key,
];
function source() {
  const fetcher: typeof fetch = async (input) =>
    new Response(
      JSON.stringify(
        String(input).includes("part_compatibility")
          ? { records: fixtureRecords }
          : { parts: [...fixtureParts, reviewCase] },
      ),
    );
  return createSnapshotSource(fetcher);
}

describe("new build with acknowledged missing product information", () => {
  it("completes all eight real-snapshot steps and retains item warnings in quote versions and saved receipts", async () => {
    const data = source();
    let state = consultReducer(initialConsultState(), {
      type: "START",
      consultationId: "review-flow",
      survey,
      plan: await data.planConsultation(survey),
    });
    const visited: string[] = [];
    for (const [index, category] of CATEGORIES.entries()) {
      expect(currentCategory(state)).toBe(category);
      visited.push(category);
      const requestId = index + 1;
      state = consultReducer(state, { type: "REQUEST", requestId });
      const result = await data.getCandidates({
        survey,
        category,
        selected: state.selected,
        budget: survey.budget,
      });
      state = consultReducer(state, { type: "CANDIDATES", requestId, result });
      const candidate = [...result.passed, ...result.needsReview].find(
        (entry) => entry.part.source_key === pickedKeys[index],
      );
      expect(candidate, `fixture candidate ${category}`).toBeDefined();
      if (["storage", "cooler", "case"].includes(category)) {
        expect(candidate!.validation.status).toBe("UNKNOWN");
        expect(candidate!.recommended).toBe(false);
        expect(consultReducer(state, { type: "SELECT", candidate: candidate! })).toBe(state);
      }
      state = consultReducer(state, { type: "SELECT", candidate: candidate!, allowUnknown: true });
    }
    expect(visited).toEqual(CATEGORIES);
    expect(isSelectionComplete(state)).toBe(true);
    const first = await data.createQuote({
      consultationId: state.consultationId,
      version: 1,
      survey,
      selected: state.selected,
    });
    state = consultReducer(consultReducer(state, { type: "QUOTE_REQUEST", requestId: 20 }), {
      type: "QUOTE_READY",
      requestId: 20,
      quote: first,
    });
    expect(state.screen).toBe("quote");
    const expectedReviews = [
      ["storage", "포트·슬롯"],
      ["cooler", "쿨러 지원 소켓"],
      ["case", "케이스의 GPU 허용 길이"],
    ];
    for (const [category, reason] of expectedReviews) {
      const item = currentQuote(state)!.reviewItems?.find((review) => review.category === category);
      expect(item?.reasons.join(" ")).toContain(reason);
      expect(first.reviewItems?.find((review) => review.category === category)).toEqual(item);
    }
    expect(first.validation.status).toBe("UNKNOWN");
    const receipt = await data.confirmQuote({
      quotes: {
        consultation_id: first.consultation_id,
        version: first.version,
        status: "CONFIRMED",
        total_amount: first.total_amount,
        currency: "KRW",
      },
      quote_items: first.items,
    });
    state = consultReducer(consultReducer(state, { type: "CONFIRM_REQUEST", requestId: 21 }), {
      type: "CONFIRMED",
      requestId: 21,
      receipt,
    });
    expect(state.receipt?.quote.reviewItems).toEqual(first.reviewItems);
    expect(receipt.quote.reviewItems).toEqual(first.reviewItems);

    // A compatible cooler replaces the warning only in the new version.
    state = consultReducer(state, { type: "EDIT_QUOTE", category: "cooler" });
    const result = await data.getCandidates({
      survey,
      category: "cooler",
      selected: state.selected,
      budget: survey.budget,
    });
    const cooler = result.passed.find(
      (entry) => entry.part.source_key === "cooler-thermalright-peerless-assassin-120-se",
    )!;
    expect(cooler).toBeDefined();
    state = consultReducer(consultReducer(state, { type: "REQUEST", requestId: 22 }), {
      type: "CANDIDATES",
      requestId: 22,
      result,
    });
    state = consultReducer(state, { type: "SELECT", candidate: cooler });
    const second = await data.createQuote({
      consultationId: state.consultationId,
      version: 2,
      survey,
      selected: state.selected,
    });
    state = consultReducer(consultReducer(state, { type: "QUOTE_REQUEST", requestId: 23 }), {
      type: "QUOTE_READY",
      requestId: 23,
      quote: second,
    });
    expect(state.quotes).toHaveLength(2);
    expect(state.quotes[0].reviewItems?.some((item) => item.category === "cooler")).toBe(true);
    expect(state.quotes[1].reviewItems?.some((item) => item.category === "cooler")).toBe(false);
  });

  it("keeps review candidates strictly price sorted and without recommendations under a brand policy", () => {
    // These UNKNOWN statuses are test event inputs, not compatibility claims about the fixture CPUs.
    const candidates: Candidate[] = fixtureParts
      .filter((part) => part.category === "cpu" && part.current_price !== null)
      .map((part) => ({
        part,
        validation: { status: "UNKNOWN", checks: [], basis: "demo" },
        recommended: true,
        reason: "must be cleared",
      }));
    const result = finishCandidates(
      candidates,
      { survey, category: "cpu", selected: {}, budget: survey.budget },
      0,
      {
        ...DEFAULT_COMPANY_POLICIES["BW-1001"],
        sort: "brand",
        preferredBrands: ["AMD"],
      },
    );
    const prices = result.needsReview.map((entry) => entry.part.current_price!);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    expect(result.passed).toHaveLength(0);
    expect(result.needsReview.every((entry) => !entry.recommended && entry.reason === "")).toBe(
      true,
    );
  });
});
