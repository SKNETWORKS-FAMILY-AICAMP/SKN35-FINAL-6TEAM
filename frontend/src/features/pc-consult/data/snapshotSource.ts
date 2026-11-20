import {
  CATEGORIES,
  type Category,
  type CompatibilityRecord,
  type ConfirmPayload,
  type Part,
  type Quote,
  type SaveReceipt,
} from "../types";
import type { ConsultDataSource } from "./ConsultDataSource";
import {
  DEMO_RULES,
  candidateFor,
  eligibleParts,
  finishCandidates,
  indexEvidence,
  planConsultation,
  proposeRebalance,
  validateConfiguration,
} from "./demoRules";

type Fetcher = typeof fetch;
interface Snapshot {
  parts: Part[];
  records: CompatibilityRecord[];
  evidence: ReturnType<typeof indexEvidence>;
}
const clone = <T>(value: T): T => structuredClone(value);
const keyFor = (consultationId: string, version: number) => `${consultationId}/${version}`;
const yieldForPaint = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Lazy, in-memory adapter. Static snapshots are never bundled or written back. */
export function createSnapshotSource(fetcher: Fetcher = globalThis.fetch): ConsultDataSource {
  let loading: Promise<Snapshot> | undefined;
  const quotes = new Map<string, Quote>();
  const latestVersion = new Map<string, number>();
  const receipts = new Map<string, SaveReceipt>();
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
        return { parts, records, evidence: indexEvidence(records) };
      })().catch((error: unknown) => {
        loading = undefined;
        throw error;
      });
    }
    return loading;
  }

  const source: ConsultDataSource = {
    async initialize() {
      await readSnapshot();
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
      const eligible = eligibleParts(parts, request);
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
      const result = finishCandidates(candidates, request, eligible.missingColorCount);
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
      return clone(proposeRebalance(parts, evidence, request, amount));
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
        selected[category] = part;
      }
      const validation = validateConfiguration(input.survey, selected, evidence);
      if (validation.status === "FAIL")
        throw new Error("호환되지 않는 부품이 있습니다. 선택 내역을 다시 확인해 주세요.");
      const items = plan.steps.map((category) => {
        const part = selected[category]!;
        return {
          source_key: part.source_key,
          category,
          part_name_snapshot: part.name,
          unit_price: part.current_price!,
          quantity: 1,
          price_checked_at: part.price_checked_at,
        };
      });
      const quote: Quote = {
        consultation_id: input.consultationId,
        version: input.version,
        status: "DRAFT",
        currency: "KRW",
        total_amount: items.reduce((total, item) => total + item.unit_price * item.quantity, 0),
        created_at: new Date().toISOString(),
        items: clone(items),
        validation: clone(validation),
      };
      const key = keyFor(input.consultationId, input.version);
      const existing = quotes.get(key);
      if (existing) {
        if (JSON.stringify(existing.items) !== JSON.stringify(quote.items))
          throw new Error("이미 만든 견적 버전입니다. 새 버전으로 만들어 주세요.");
        return clone(existing);
      }
      if (input.version <= (latestVersion.get(input.consultationId) ?? 0))
        throw new Error("이전 견적을 덮어쓸 수 없습니다. 새 버전으로 만들어 주세요.");
      quotes.set(key, clone(quote));
      latestVersion.set(input.consultationId, input.version);
      return clone(quote);
    },
    async confirmQuote(payload: ConfirmPayload) {
      const header = payload.quotes;
      const key = keyFor(header.consultation_id, header.version);
      const original = quotes.get(key);
      if (
        !original ||
        header.status !== "CONFIRMED" ||
        header.currency !== "KRW" ||
        header.total_amount !== original.total_amount ||
        JSON.stringify(payload.quote_items) !== JSON.stringify(original.items)
      ) {
        throw new Error("승인할 견적이 현재 견적과 다릅니다. 견적을 다시 확인해 주세요.");
      }
      const receipt = receipts.get(key);
      if (receipt) return clone(receipt);
      if (header.version !== latestVersion.get(header.consultation_id))
        throw new Error("새 견적이 있어 이전 버전을 승인할 수 없습니다.");
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

export const snapshotSource = createSnapshotSource();
