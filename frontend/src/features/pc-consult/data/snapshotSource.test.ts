import { describe, expect, it, vi } from "vitest";
import { fixtureParts, fixtureRecords } from "../fixtures/demoSnapshot.fixture";
import {
  CATEGORIES,
  type ConfirmPayload,
  type Quote,
  type SelectionMap,
  type Survey,
} from "../types";
import { createSnapshotSource } from "./snapshotSource";

const survey: Survey = {
  mode: "new",
  budget: 3000000,
  purposes: ["gaming"],
  resolution: "fhd",
  frameRate: "60",
  workScale: "basic",
  problems: [],
  problemNote: "",
  owned: {},
};
const fetcher = () =>
  vi
    .fn<typeof fetch>()
    .mockImplementation(
      async (input) =>
        new Response(
          JSON.stringify(
            String(input).includes("part_compatibility")
              ? { records: fixtureRecords }
              : { parts: fixtureParts },
          ),
          { status: 200 },
        ),
    );
const selection = (): SelectionMap => {
  const keys = [
    "amd-ryzen-5-7600",
    "mb-asus-tuf-gaming-b850-plus-wifi",
    "ram-gskill-f5-6000j3636f32gx2-fx5",
    "gpu-msi-3060-ventus-2x-12g",
    "docyx:f05d1550ae36444134bdf29a0b110a125c3313cf77b77793d46a1d582a5877a3",
    "cooler-thermalright-peerless-assassin-120-se",
    "docyx:5f4cbd8dce220c209ba0c26b04120fb561d84facb4720a7f4c10b13825d92858",
    "case-nzxt-h5-flow-2024-black",
  ];
  return Object.fromEntries(
    keys.map((key) => {
      const part = fixtureParts.find((row) => row.source_key === key)!;
      return [part.category, part];
    }),
  );
};
const payload = (quote: Quote): ConfirmPayload => ({
  quote_id: quote.quote_id,
  version: quote.version,
  acceptConditions: true,
});

describe("snapshot adapter", () => {
  it("fetches each snapshot once, lazily, even for simultaneous callers", async () => {
    const fetch = fetcher();
    const source = createSnapshotSource(fetch);
    expect(fetch).not.toHaveBeenCalled();
    await Promise.all([source.initialize(), source.initialize(), source.searchParts("cpu", "")]);
    expect(fetch).toHaveBeenCalledTimes(2);
    await source.searchParts("cpu", "7600");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("clears rejected loading promises so retry can succeed", async () => {
    const fetch = fetcher().mockRejectedValueOnce(new Error("offline"));
    const source = createSnapshotSource(fetch);
    await expect(source.initialize()).rejects.toThrow("offline");
    await expect(source.initialize()).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(4);
  });
  it("emits ready only after all actual candidate checks finish", async () => {
    const source = createSnapshotSource(fetcher());
    const progress = vi.fn();
    const result = await source.getCandidates(
      { survey, category: "cpu", budget: 3000000, selected: {} },
      progress,
    );
    const last = progress.mock.calls.at(-1)![0];
    expect(last.phase).toBe("ready");
    expect(last.completed).toBe(last.total);
    expect(last.total).toBe(
      result.passed.length + result.needsReview.length + result.rejectedCount,
    );
    expect(progress.mock.calls.some(([update]) => update.phase === "validation")).toBe(true);
  });
  it("rejects incomplete configurations and final compatibility failures", async () => {
    const source = createSnapshotSource(fetcher());
    await expect(
      source.createQuote({ consultationId: "demo", version: 1, survey, selected: {} }),
    ).rejects.toThrow("모든 상담 단계");
    const selected = selection();
    selected.case = fixtureParts.find(
      (row) =>
        row.source_key === "docyx:616060da1b3d3a9b95ad26ccf87d45d0db2f3b6595ccf7c7fe8a566646cdc4d0",
    );
    await expect(
      source.createQuote({ consultationId: "demo", version: 1, survey, selected }),
    ).rejects.toThrow("호환되지 않는");
  });
  it("preserves quote versions, snapshots prices, and confirms idempotently in memory", async () => {
    const source = createSnapshotSource(fetcher());
    const selected = selection();
    expect(Object.keys(selected)).toHaveLength(CATEGORIES.length);
    const v1 = await source.createQuote({ consultationId: "demo", version: 1, survey, selected });
    const receipt = await source.confirmQuote(payload(v1));
    expect(receipt.storage).toBe("memory");
    expect(receipt.quote.status).toBe("CONFIRMED");
    expect(receipt.message).toContain("DB에 기록 안 됨");
    expect(await source.confirmQuote(payload(v1))).toEqual(receipt);
    selected.case = fixtureParts.find((row) => row.source_key === "case-nzxt-h5-flow-2024-white");
    const v2 = await source.createQuote({ consultationId: "demo", version: 2, survey, selected });
    expect(v2.version).toBe(v1.version + 1);
    expect(v2.status).toBe("DRAFT");
    expect(v1.items.find((item) => item.category === "case")!.source_key).toBe(
      "case-nzxt-h5-flow-2024-black",
    );
    expect(await source.confirmQuote(payload(v1))).toEqual(receipt);
    receipt.quote.items[0].unit_price = 1;
    expect((await source.confirmQuote(payload(v1))).quote.items[0].unit_price).not.toBe(1);
  });
  it("rejects tampered payload and superseded unconfirmed versions", async () => {
    const source = createSnapshotSource(fetcher());
    const selected = selection();
    const v1 = await source.createQuote({ consultationId: "demo", version: 1, survey, selected });
    const changed = { ...payload(v1), version: v1.version + 1 };
    await expect(source.confirmQuote(changed)).rejects.toThrow("현재 견적과 다릅니다");
    await source.createQuote({ consultationId: "demo", version: 2, survey, selected });
    await expect(source.confirmQuote(payload(v1))).rejects.toThrow(
      "이전 버전을 승인할 수 없습니다",
    );
  });
});
