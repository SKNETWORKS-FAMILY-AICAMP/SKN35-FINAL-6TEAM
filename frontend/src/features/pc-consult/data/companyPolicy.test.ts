import { describe, expect, it, vi } from "vitest";
import { fixtureParts, fixtureRecords } from "../fixtures/demoSnapshot.fixture";
import {
  CATEGORIES,
  type CandidateRequest,
  type ConfirmPayload,
  type Quote,
  type Survey,
} from "../types";
import { DEFAULT_COMPANY_POLICIES, type CompanyPolicy } from "./companyPolicy";
import { applyResponsePolicy, filterCandidates, indexEvidence, policyHandoff } from "./demoRules";
import { createCompanySource } from "./snapshotSource";

// Parts/records and these metadata values are from the read-only 2026-11-18 snapshots.
const metadata = {
  rows: 9917,
  fx_date: "2026-11-06",
  generated_at: "2026-11-18T07:24:32.006880+00:00",
};
const makeFetcher = () =>
  vi
    .fn<typeof fetch>()
    .mockImplementation(
      async (input) =>
        new Response(
          JSON.stringify(
            String(input).includes("part_compatibility")
              ? { meta: { rows: 23032 }, records: fixtureRecords }
              : { meta: metadata, parts: fixtureParts },
          ),
          { status: 200 },
        ),
    );
const policy = (changes: Partial<CompanyPolicy> = {}): CompanyPolicy => ({
  ...structuredClone(DEFAULT_COMPANY_POLICIES["BW-1001"]),
  ...changes,
});
const survey: Survey = {
  mode: "new",
  budget: 3000000,
  purposes: ["other"],
  resolution: "fhd",
  frameRate: "60",
  workScale: "basic",
  problems: [],
  problemNote: "",
  owned: {},
};
const evidence = indexEvidence(fixtureRecords);
const ramRequest: CandidateRequest = {
  survey,
  category: "ram",
  budget: 500000,
  selected: {
    motherboard: fixtureParts.find(
      (part) => part.source_key === "mb-asus-tuf-gaming-b850-plus-wifi",
    )!,
  },
};
const payload = (quote: Quote): ConfirmPayload => ({
  quote_id: quote.quote_id,
  version: quote.version,
  acceptConditions: true,
});

describe("company policies over the actual snapshot fixture", () => {
  it("never recommends the already-owned source key as a replacement and selects a distinct demo baseline", async () => {
    const source = createCompanySource(policy(), makeFetcher());
    const demo = await source.getDemoSurvey!();
    const first = await source.getCandidates({
      survey: demo,
      category: "ram",
      budget: demo.budget,
      selected: {},
    });
    expect(first.passed.length).toBeGreaterThan(0);
    expect(first.passed[0].part.source_key).not.toBe(demo.owned.ram?.part?.source_key);
    const ownedPart = first.passed[0].part;
    const alreadyOwned = {
      ...demo,
      owned: {
        ...demo.owned,
        ram: { category: "ram" as const, name: ownedPart.name, part: ownedPart },
      },
    };
    const next = await source.getCandidates({
      survey: alreadyOwned,
      category: "ram",
      budget: demo.budget,
      selected: {},
    });
    expect(
      [...next.passed, ...next.needsReview].some(
        (candidate) => candidate.part.source_key === ownedPart.source_key,
      ),
    ).toBe(false);
    expect(next.criteria.join(" ")).toContain("동일 제품은 교체 후보에서 제외");
  });

  it("changes recommendation order using real brands while keeping exactly one passed recommendation", () => {
    const byPrice = filterCandidates(fixtureParts, ramRequest, evidence, policy());
    const byBrand = filterCandidates(
      fixtureParts,
      ramRequest,
      evidence,
      policy({ sort: "brand", preferredBrands: ["G.Skill"] }),
    );
    expect(byPrice.passed[0].part.brand).toBe("Corsair");
    expect(byBrand.passed[0].part.brand).toBe("G.Skill");
    expect(byBrand.passed.filter((candidate) => candidate.recommended)).toHaveLength(1);
    expect(byBrand.passed[0].recommended).toBe(true);
    expect(byBrand.needsReview.every((candidate) => !candidate.recommended)).toBe(true);
    expect(byBrand.sortLabel).toContain("선호 브랜드");
    expect(byBrand.sortLabel).toContain("판매량 데이터 준비 중");
    expect(byBrand.policyLabel).toContain("정책 v1");
  });

  it("changes a five percent discount handoff when the policy ceiling changes from three to seven", () => {
    const request = { ...ramRequest, requestedDiscountPercent: 5 };
    const strict = filterCandidates(fixtureParts, request, evidence, policy());
    const relaxed = filterCandidates(
      fixtureParts,
      request,
      evidence,
      policy({ version: 2, maxDiscountPercent: 7 }),
    );
    expect(strict.handoff?.required).toBe(true);
    expect(strict.handoff?.reasons.join(" ")).toContain("5%");
    expect(relaxed.handoff).toEqual({ required: false, reasons: [] });
    expect(relaxed.passed.map((candidate) => candidate.part.current_price)).toEqual(
      strict.passed.map((candidate) => candidate.part.current_price),
    );
  });

  it("keeps unknown candidates separate and escalates missing or conditional evidence only when configured", () => {
    const unknown = filterCandidates(
      fixtureParts.filter((part) => !Array.isArray(part.specs.sockets)),
      {
        survey,
        category: "cooler",
        selected: { cpu: fixtureParts[0] },
        budget: 500000,
      },
      evidence,
      policy(),
    );
    expect(unknown.needsReview.length).toBeGreaterThan(0);
    expect(unknown.needsReview.every((candidate) => !candidate.recommended)).toBe(true);
    expect(unknown.handoff?.required).toBe(true);
    expect(
      policyHandoff(policy({ handoffUnknown: false, handoffConditional: false }), {
        total: 100000,
        validation: unknown.needsReview[0].validation,
      }).required,
    ).toBe(false);
    const conditional = fixtureRecords.find(
      (record) => record.check_type === "CPU_SUPPORT" && record.support_status === "CONDITIONAL",
    )!;
    const cpu = fixtureParts.find(
      (part) =>
        part.category === "cpu" &&
        [conditional.part_a_key, conditional.part_b_key].includes(part.source_key),
    )!;
    const board = fixtureParts.find(
      (part) =>
        part.category === "motherboard" &&
        [conditional.part_a_key, conditional.part_b_key].includes(part.source_key),
    )!;
    const result = filterCandidates(
      [board],
      { survey, category: "motherboard", selected: { cpu }, budget: 1000000 },
      evidence,
      policy(),
    );
    expect(result.passed[0].validation.status).toBe("CONDITIONAL");
    expect(result.handoff?.reasons.join(" ")).toContain("조건부");
  });

  it("enforces automatic quote ceilings and rejects invalid policy or discount numbers", () => {
    expect(policyHandoff(policy({ autoQuoteLimit: 100000 }), { total: 100001 }).required).toBe(
      true,
    );
    expect(() => policyHandoff(policy(), { total: 1, requestedDiscountPercent: NaN })).toThrow(
      "할인율",
    );
    expect(() =>
      createCompanySource(policy({ maxDiscountPercent: Infinity }), makeFetcher()),
    ).toThrow("기업 정책");
    expect(() => createCompanySource(policy({ autoQuoteLimit: -1 }), makeFetcher())).toThrow(
      "기업 정책",
    );
  });

  it("replaces configured employee phrases without mutating the policy", () => {
    const rules = policy({ forbiddenPhrases: ["최저가 보장", "무조건 호환", " "] });
    const response = applyResponsePolicy("최저가 보장! 무조건 호환합니다. 최저가 보장", rules);
    expect(response).not.toContain("최저가 보장");
    expect(response).not.toContain("무조건 호환");
    expect(response).toContain("담당자 확인 후 안내");
    expect(rules.forbiddenPhrases[0]).toBe("최저가 보장");
  });

  it("shares a lazy read cache across companies and counts actual arrays instead of metadata totals", async () => {
    const fetcher = makeFetcher();
    const a = createCompanySource(DEFAULT_COMPANY_POLICIES["BW-1001"], fetcher);
    const b = createCompanySource(DEFAULT_COMPANY_POLICIES["BW-2002"], fetcher);
    expect(fetcher).not.toHaveBeenCalled();
    const [summaryA, summaryB] = await Promise.all([
      a.getCatalogSummary!(),
      b.getCatalogSummary!(),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(summaryA.totalParts).toBe(fixtureParts.length);
    expect(summaryA.compatibilityCount).toBe(fixtureRecords.length);
    expect(summaryA.priceDate).toBe(metadata.fx_date);
    expect(summaryA.generatedAt).toBe(metadata.generated_at);
    expect(summaryA.scopedParts).toBe(fixtureParts.length);
    expect(summaryB.scopedParts).toBeLessThan(summaryA.scopedParts);
    expect(summaryB.categoryCounts.cpu).toBe(
      fixtureParts.filter((part) => part.category === "cpu" && part.brand === "AMD").length,
    );
    expect(CATEGORIES.every((category) => summaryB.categoryCounts[category] > 0)).toBe(true);
    expect(await b.searchParts("cpu", "Intel")).not.toHaveLength(0);
    summaryB.categoryCounts.cpu = 0;
    expect((await b.getCatalogSummary!()).categoryCounts.cpu).toBeGreaterThan(0);
  });

  it("retries a failed shared read and snapshots policy values rather than a mutable reference", async () => {
    const fetcher = makeFetcher().mockRejectedValueOnce(new Error("offline"));
    const rules = policy();
    const source = createCompanySource(rules, fetcher);
    rules.maxDiscountPercent = 99;
    await expect(source.initialize()).rejects.toThrow("offline");
    const result = await source.getCandidates({ ...ramRequest, requestedDiscountPercent: 5 });
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(result.handoff?.required).toBe(true);
  });

  it("loads the same one-step replacement survey with real owned parts for both companies", async () => {
    const fetcher = makeFetcher();
    const a = createCompanySource(DEFAULT_COMPANY_POLICIES["BW-1001"], fetcher);
    const b = createCompanySource(DEFAULT_COMPANY_POLICIES["BW-2002"], fetcher);
    const demo = await a.getDemoSurvey!();
    expect(await b.getDemoSurvey!()).toEqual(demo);
    expect(demo.mode).toBe("replacement");
    expect((await a.planConsultation(demo)).steps).toEqual(["ram"]);
    expect(
      Object.values(demo.owned).every((owned) =>
        fixtureParts.some((part) => part.source_key === owned.part?.source_key),
      ),
    ).toBe(true);
    const request = { survey: demo, category: "ram" as const, selected: {}, budget: demo.budget };
    const resultA = await a.getCandidates(request);
    const resultB = await b.getCandidates(request);
    expect(resultA.passed[0].part.brand).toBe("Corsair");
    expect(resultB.passed[0].part.brand).toBe("G.Skill");
    expect(
      resultB.passed.every((candidate) => ["G.Skill", "Kingston"].includes(candidate.part.brand)),
    ).toBe(true);
  });

  it("isolates quote records between companies and preserves versions across policy updates", async () => {
    const fetcher = makeFetcher();
    const a = createCompanySource(policy({ handoffUnknown: false }), fetcher);
    const b = createCompanySource(
      policy({ companyCode: "BW-2002", handoffUnknown: false }),
      fetcher,
    );
    const demo = await a.getDemoSurvey!();
    const results = await a.getCandidates({
      survey: demo,
      category: "ram",
      selected: {},
      budget: demo.budget,
    });
    const selected = { ram: results.passed[0].part };
    const v1 = await a.createQuote({
      consultationId: "shared-id",
      version: 1,
      survey: demo,
      selected,
    });
    await expect(b.confirmQuote(payload(v1))).rejects.toThrow("현재 견적과 다릅니다");
    const receipt = await a.confirmQuote(payload(v1));
    expect(receipt.quote.status).toBe("CONFIRMED");
    const updated = createCompanySource(
      policy({ version: 2, maxDiscountPercent: 7, handoffUnknown: false }),
      fetcher,
    );
    const v2 = await updated.createQuote({
      consultationId: "shared-id",
      version: 2,
      survey: demo,
      selected,
    });
    expect(v2.version).toBe(2);
    expect(await updated.confirmQuote(payload(v1))).toEqual(receipt);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("enforces final handoff and retains a requested discount in the immutable quote version", async () => {
    const fetcher = makeFetcher();
    const source = createCompanySource(policy({ handoffUnknown: false }), fetcher);
    const demo = await source.getDemoSurvey!();
    const result = await source.getCandidates({
      survey: demo,
      category: "ram",
      selected: {},
      budget: demo.budget,
    });
    const input = {
      consultationId: "discount",
      version: 1,
      survey: demo,
      selected: { ram: result.passed[0].part },
      requestedDiscountPercent: 5,
    };
    const quote = await source.createQuote(input);
    expect(quote.handoff?.required).toBe(true);
    await expect(source.confirmQuote(payload(quote))).rejects.toThrow("담당자 확인");
    await expect(source.createQuote({ ...input, requestedDiscountPercent: 0 })).rejects.toThrow(
      "이미 만든 견적",
    );
    const relaxed = createCompanySource(
      policy({ version: 2, maxDiscountPercent: 7, handoffUnknown: false }),
      fetcher,
    );
    const revised = await relaxed.createQuote({ ...input, version: 2 });
    expect(revised.handoff?.required).toBe(false);
    await expect(relaxed.confirmQuote(payload(revised))).resolves.toMatchObject({
      quote: { status: "CONFIRMED" },
    });
  });

  it("rejects out-of-scope parts when creating or confirming a quote after a scope change", async () => {
    const fetcher = makeFetcher();
    const source = createCompanySource(policy({ handoffUnknown: false }), fetcher);
    const demo = await source.getDemoSurvey!();
    const ram = fixtureParts.find((part) => part.category === "ram" && part.brand === "Corsair")!;
    const input = { consultationId: "scope", version: 1, survey: demo, selected: { ram } };
    const quote = await source.createQuote(input);
    const narrowed = createCompanySource(
      policy({ version: 2, handoffUnknown: false, allowedBrands: { ram: ["G.Skill"] } }),
      fetcher,
    );
    await expect(narrowed.confirmQuote(payload(quote))).rejects.toThrow("취급 범위");
    await expect(narrowed.createQuote({ ...input, version: 2 })).rejects.toThrow("취급 범위");
  });
});
