import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { priceLabel, won, type Survey } from "../types";
import { fixtureParts } from "../fixtures/snapshot.fixture";

const requests: Request[] = [];
const fetcher = vi.fn(async (request: Request) => {
  requests.push(request);
  return Response.json({});
});

beforeEach(() => {
  requests.length = 0;
  vi.resetModules();
  vi.stubGlobal("fetch", fetcher);
  const NativeRequest = Request;
  vi.stubGlobal(
    "Request",
    class extends NativeRequest {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        super(typeof input === "string" ? new URL(input, "http://localhost") : input, init);
      }
    },
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("live consultation transport", () => {
  const cpu = fixtureParts.find((part) => part.category === "cpu")!;
  const survey: Survey = {
    mode: "replacement",
    purposes: ["gaming"],
    budget: 1000000,
    resolution: "fhd",
    frameRate: "60",
    workScale: "basic",
    problems: ["gaming"],
    problemNote: "",
    owned: { cpu: { category: "cpu", name: cpu.name, part: cpu } },
  };
  it("sends server IDs for selections and owned parts without client prices", async () => {
    const { createApiSource } = await import("./apiSource");
    await createApiSource("bound-session").getCandidates({
      survey,
      category: "gpu",
      budget: 400000,
      selected: { cpu },
    });
    expect(new URL(requests[0].url).pathname).toBe(
      "/api/pc-consult/sessions/bound-session/candidates",
    );
    const body = await requests[0].json();
    expect(body.selected).toEqual({ cpu: cpu.part_id });
    expect(body.survey.owned.cpu).toEqual({
      category: "cpu",
      name: cpu.name,
      part_id: cpu.part_id,
    });
    expect(JSON.stringify(body)).not.toContain("current_price");
  });
  it("uses the shown server quote ID and propagates a stale approval", async () => {
    fetcher.mockImplementationOnce(async (request) => {
      requests.push(request);
      return Response.json({ detail: "최신 견적을 확인해 주세요." }, { status: 409 });
    });
    const { createApiSource } = await import("./apiSource");
    await expect(
      createApiSource("session").confirmQuote({
        quote_id: "server-issued-quote",
        version: 3,
        acceptConditions: true,
      }),
    ).rejects.toThrow("최신 견적");
    expect(new URL(requests[0].url).pathname).toBe(
      "/api/pc-consult/sessions/session/quotes/3/confirm",
    );
    expect(await requests[0].json()).toEqual({
      quote_id: "server-issued-quote",
      accept_conditions: true,
    });
  });
  it("keeps missing prices distinct from zero and shows currency conversions and checked dates", () => {
    expect(won(null)).toBe("가격 미등록");
    expect(won(0)).toBe("₩0");
    expect(
      priceLabel({
        price_status: "test",
        price_basis: "USD_FX_REFERENCE",
        price_checked_at: "2026-11-18T00:00:00Z",
      }),
    ).toBe("테스트 가격 · 미 달러 환산 · 기록일 2026-11-18");
    expect(priceLabel({ price_status: "unconfirmed" })).toBe("미확인 가격");
    expect(priceLabel(undefined)).toBe("가격 출처 미확인");
    expect(priceLabel({})).toBe("가격 상태 미확인");
    expect(priceLabel({ price_status: "confirmed" })).toBe("DB 확인 가격");
  });
});
