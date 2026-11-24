import {
  CATEGORIES,
  type Category,
  type CatalogSummary,
  type CompatibilityRecord,
  type ConfirmPayload,
  type Part,
  type Quote,
  type SaveReceipt,
} from "../types";
import type { ConsultDataSource } from "./ConsultDataSource";
import type { CompanyPolicy } from "./companyPolicy";
import {
  DEMO_RULES,
  candidateFor,
  companyPolicyLabel,
  configurationReviews,
  demoSurveyFromParts,
  eligibleParts,
  finishCandidates,
  indexEvidence,
  planConsultation,
  partAllowedByPolicy,
  policyHandoff,
  proposeRebalance,
  validateConfiguration,
  validateCompanyPolicy,
} from "./demoRules";

type Fetcher = typeof fetch;
interface Snapshot {
  parts: Part[];
  records: CompatibilityRecord[];
  evidence: ReturnType<typeof indexEvidence>;
  priceDate: string | null;
  generatedAt: string | null;
}
const clone = <T>(value: T): T => structuredClone(value);
const keyFor = (consultationId: string, version: number) => `${consultationId}/${version}`;
const yieldForPaint = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

interface QuoteStore {
  quotes: Map<string, Quote>;
  latestVersion: Map<string, number>;
  receipts: Map<string, SaveReceipt>;
  discounts: Map<string, number>;
}
const createQuoteStore = (): QuoteStore => ({
  quotes: new Map(),
  latestVersion: new Map(),
  receipts: new Map(),
  discounts: new Map(),
});

/** Shared read cache contains only the immutable catalog, never tenant quote records. */
function createSnapshotReader(fetcher: Fetcher) {
  let loading: Promise<Snapshot> | undefined;
  async function readSnapshot(): Promise<Snapshot> {
    if (!loading) {
      loading = (async () => {
        const base = import.meta.env.BASE_URL;
        const responses = await Promise.all([
          fetcher(`${base}demo-data/parts.snapshot.json`),
          fetcher(`${base}demo-data/part_compatibility.snapshot.json`),
        ]);
        if (responses.some((response) => !response.ok))
          throw new Error("스냅샷을 불러오지 못했습니다. 다시 시도해 주세요.");
        const [partsData, compatibilityData] = await Promise.all(
          responses.map((response) => response.json()),
        );
        if (!Array.isArray(partsData.parts) || !Array.isArray(compatibilityData.records))
          throw new Error("스냅샷 형식이 올바르지 않습니다.");
        const parts = partsData.parts as Part[],
          records = compatibilityData.records as CompatibilityRecord[];
        if (
          parts.some(
            (part) => !part.source_key || !CATEGORIES.includes(part.category) || !part.specs,
          )
        )
          throw new Error("부품 스냅샷에 필수 정보가 없습니다.");
        return {
          parts,
          records,
          evidence: indexEvidence(records),
          priceDate: typeof partsData.meta?.fx_date === "string" ? partsData.meta.fx_date : null,
          generatedAt:
            typeof partsData.meta?.generated_at === "string" ? partsData.meta.generated_at : null,
        };
      })().catch((error: unknown) => {
        loading = undefined;
        throw error;
      });
    }
    return loading;
  }
  return readSnapshot;
}

/** 스냅샷 시연 데이터 소스. 처음에 스냅샷을 읽어 두는 initialize 를 늘 갖습니다. */
export type SnapshotDataSource = ConsultDataSource & { initialize(): Promise<void> };

function createSource(
  readSnapshot: ReturnType<typeof createSnapshotReader>,
  store: QuoteStore,
  policy?: CompanyPolicy,
): SnapshotDataSource {
  const { quotes, latestVersion, receipts, discounts } = store;

  const source: SnapshotDataSource = {
    async initialize() {
      await readSnapshot();
    },
    async getCatalogSummary(): Promise<CatalogSummary> {
      const snapshot = await readSnapshot();
      const scoped = snapshot.parts.filter((part) => partAllowedByPolicy(part, policy));
      const categoryCounts = Object.fromEntries(
        CATEGORIES.map((category) => [category, 0]),
      ) as Record<Category, number>;
      for (const part of scoped) categoryCounts[part.category]++;
      return {
        categoryCounts,
        totalParts: snapshot.parts.length,
        scopedParts: scoped.length,
        compatibilityCount: snapshot.records.length,
        priceDate: snapshot.priceDate,
        generatedAt: snapshot.generatedAt,
        brands: [...new Set(scoped.map((part) => part.brand))].sort(),
      };
    },
    async getDemoSurvey() {
      const { parts, evidence } = await readSnapshot();
      return clone(demoSurveyFromParts(parts, evidence));
    },
    async searchParts(category, query) {
      const { parts } = await readSnapshot();
      const needle = query.trim().toLocaleLowerCase();
      return parts
        .filter(
          (part) =>
            part.category === category &&
            (!needle ||
              `${part.brand} ${part.name} ${part.source_key}`.toLocaleLowerCase().includes(needle)),
        )
        .sort(
          (a, b) =>
            (a.current_price ?? Infinity) - (b.current_price ?? Infinity) ||
            a.source_key.localeCompare(b.source_key),
        )
        .slice(0, 20)
        .map(clone);
    },
    async planConsultation(survey) {
      await readSnapshot();
      return planConsultation(survey);
    },
    async getCandidates(request, onProgress) {
      if (!Number.isFinite(request.budget) || request.budget < 0)
        throw new Error("부품 예산을 올바르게 입력해 주세요.");
      onProgress?.({ phase: "loading", completed: 0, total: 0 });
      const { parts, evidence } = await readSnapshot();
      onProgress?.({ phase: "design", completed: 0, total: 0 });
      await yieldForPaint();
      const eligible = eligibleParts(parts, request, policy);
      const candidates: ReturnType<typeof candidateFor>[] = [];
      onProgress?.({ phase: "validation", completed: 0, total: eligible.parts.length });
      for (let offset = 0; offset < eligible.parts.length; offset += DEMO_RULES.chunkSize) {
        const chunk = eligible.parts.slice(offset, offset + DEMO_RULES.chunkSize);
        candidates.push(...chunk.map((part) => candidateFor(part, request, evidence)));
        onProgress?.({
          phase: "validation",
          completed: candidates.length,
          total: eligible.parts.length,
        });
        await yieldForPaint();
      }
      const result = finishCandidates(candidates, request, eligible.missingColorCount, policy);
      onProgress?.({
        phase: "ready",
        completed: eligible.parts.length,
        total: eligible.parts.length,
      });
      return clone(result);
    },
    async validate(survey, selected) {
      const { evidence } = await readSnapshot();
      return validateConfiguration(survey, selected, evidence);
    },
    async rebalance(request, amount) {
      const { parts, evidence } = await readSnapshot();
      return clone(proposeRebalance(parts, evidence, request, amount, policy));
    },
    async createQuote(input) {
      const { parts, evidence } = await readSnapshot();
      if (!input.consultationId || !Number.isInteger(input.version) || input.version <= 0)
        throw new Error("상담과 견적 버전 정보가 올바르지 않습니다.");
      const plan = planConsultation(input.survey);
      if (plan.steps.some((category) => !input.selected[category]))
        throw new Error("모든 상담 단계의 부품을 선택한 뒤 견적을 만들어 주세요.");
      const known = new Map(parts.map((part) => [part.source_key, part]));
      const selected: Partial<Record<Category, Part>> = {};
      for (const category of plan.steps) {
        const part = known.get(input.selected[category]!.source_key);
        if (!part || part.category !== category || part.current_price === null)
          throw new Error("부품 또는 가격 정보를 확인할 수 없습니다.");
        if (!partAllowedByPolicy(part, policy))
          throw new Error("현재 기업의 취급 범위에 없는 부품입니다. 후보를 다시 선택해 주세요.");
        selected[category] = part;
      }
      const validation = validateConfiguration(input.survey, selected, evidence);
      if (validation.status === "FAIL")
        throw new Error("호환되지 않는 부품이 있습니다. 선택 내역을 다시 확인해 주세요.");
      const items = plan.steps.map((category) => {
        const part = selected[category]!;
        return {
          part_id: part.part_id,
          source_key: part.source_key,
          category,
          part_name_snapshot: part.name,
          unit_price: part.current_price!,
          quantity: 1,
          price_checked_at: part.price_checked_at,
        };
      });
      const quote: Quote = {
        quote_id: keyFor(input.consultationId, input.version),
        consultation_id: input.consultationId,
        version: input.version,
        status: "DRAFT",
        currency: "KRW",
        total_amount: items.reduce((total, item) => total + item.unit_price * item.quantity, 0),
        created_at: new Date().toISOString(),
        items: clone(items),
        validation: clone(validation),
        reviewItems: configurationReviews(input.survey, selected, evidence),
        ...(policy
          ? {
              policyLabel: companyPolicyLabel(policy),
              handoff: policyHandoff(policy, {
                validation,
                total: items.reduce((sum, item) => sum + item.unit_price * item.quantity, 0),
                requestedDiscountPercent: input.requestedDiscountPercent,
              }),
            }
          : {}),
      };
      const key = keyFor(input.consultationId, input.version);
      const existing = quotes.get(key);
      if (existing) {
        if (
          JSON.stringify(existing.items) !== JSON.stringify(quote.items) ||
          (discounts.get(key) ?? 0) !== (input.requestedDiscountPercent ?? 0)
        )
          throw new Error("이미 만든 견적 버전입니다. 새 버전으로 만들어 주세요.");
        return clone(existing);
      }
      if (input.version <= (latestVersion.get(input.consultationId) ?? 0))
        throw new Error("이전 견적을 덮어쓸 수 없습니다. 새 버전으로 만들어 주세요.");
      quotes.set(key, clone(quote));
      discounts.set(key, input.requestedDiscountPercent ?? 0);
      latestVersion.set(input.consultationId, input.version);
      return clone(quote);
    },
    async confirmQuote(payload: ConfirmPayload) {
      // 상담 서버 승인 계약(quote_id · version · 조건 동의)과 같은 모양으로 받습니다.
      const key = payload.quote_id;
      const original = quotes.get(key);
      if (!original || original.version !== payload.version) {
        throw new Error("승인할 견적이 현재 견적과 다릅니다. 견적을 다시 확인해 주세요.");
      }
      if (original.validation.status !== "PASS" && !payload.acceptConditions)
        throw new Error("조건부 또는 확인이 필요한 항목에 동의해야 견적을 승인할 수 있습니다.");
      const receipt = receipts.get(key);
      if (receipt) return clone(receipt);
      if (payload.version !== latestVersion.get(original.consultation_id))
        throw new Error("새 견적이 있어 이전 버전을 승인할 수 없습니다.");
      if (policy) {
        const decision = policyHandoff(policy, {
          validation: original.validation,
          total: original.total_amount,
          requestedDiscountPercent: discounts.get(key),
        });
        if (decision.required)
          throw new Error(
            `담당자 확인이 필요해 자동 확정할 수 없습니다. ${decision.reasons.join(" ")}`,
          );
        const { parts } = await readSnapshot();
        const known = new Map(parts.map((part) => [part.source_key, part]));
        if (
          original.items.some((item) => {
            const part = known.get(item.source_key);
            return !part || !partAllowedByPolicy(part, policy);
          })
        )
          throw new Error("기업 취급 범위가 변경되었습니다. 새 견적을 만들어 주세요.");
      }
      const confirmed: Quote = { ...clone(original), status: "CONFIRMED" };
      const saved: SaveReceipt = {
        quote: confirmed,
        storage: "memory",
        message: "시연 저장 (DB에 기록 안 됨) · 새로고침하면 저장 내역이 사라집니다.",
      };
      quotes.set(key, clone(confirmed));
      receipts.set(key, clone(saved));
      return clone(saved);
    },
  };
  return source;
}

/** Existing standalone adapter keeps its own cache and original policy-free behavior. */
export function createSnapshotSource(fetcher: Fetcher = globalThis.fetch): SnapshotDataSource {
  return createSource(createSnapshotReader(fetcher), createQuoteStore());
}

const companyRuntimes = new WeakMap<
  Fetcher,
  {
    read: ReturnType<typeof createSnapshotReader>;
    stores: Map<string, QuoteStore>;
  }
>();

function sharedRuntime(fetcher: Fetcher) {
  let runtime = companyRuntimes.get(fetcher);
  if (!runtime) {
    runtime = { read: createSnapshotReader(fetcher), stores: new Map() };
    companyRuntimes.set(fetcher, runtime);
  }
  return runtime;
}

/** Optional fetcher is for isolated tests; all normal company sources share the lazy reader. */
export function createCompanySource(
  policy: CompanyPolicy,
  fetcher: Fetcher = globalThis.fetch,
): SnapshotDataSource {
  validateCompanyPolicy(policy);
  const runtime = sharedRuntime(fetcher);
  let store = runtime.stores.get(policy.companyCode);
  if (!store) {
    store = createQuoteStore();
    runtime.stores.set(policy.companyCode, store);
  }
  return createSource(runtime.read, store, clone(policy));
}

export const snapshotSource = createSource(
  sharedRuntime(globalThis.fetch).read,
  createQuoteStore(),
);
