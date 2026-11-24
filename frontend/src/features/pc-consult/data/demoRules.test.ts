import { describe, expect, it } from "vitest";
import { fixtureParts, fixtureRecords } from "../fixtures/demoSnapshot.fixture";
import {
  CATEGORIES,
  type CandidateRequest,
  type Category,
  type Part,
  type SelectionMap,
  type Survey,
} from "../types";
import {
  allocateBudget,
  filterCandidates,
  indexEvidence,
  planConsultation,
  proposeRebalance,
  validateConfiguration,
} from "./demoRules";

export const survey: Survey = {
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
const part = (key: string): Part => {
  const found = fixtureParts.find((row) => row.source_key === key);
  if (!found) throw new Error(`Fixture missing: ${key}`);
  return found;
};
const cpu = part("amd-ryzen-5-7600"),
  board = part("mb-asus-tuf-gaming-b850-plus-wifi");
const evidence = indexEvidence(fixtureRecords);
const request = (category: Category, selected: SelectionMap = {}): CandidateRequest => ({
  survey,
  category,
  selected,
  budget: 3000000,
});

describe("explicit snapshot demo rules", () => {
  it("plans all eight new-build steps and only mapped replacement steps", () => {
    expect(planConsultation(survey).steps).toEqual([...CATEGORIES]);
    expect(
      planConsultation({ ...survey, mode: "replacement", problems: ["multitasking", "gaming"] })
        .steps,
    ).toEqual(["gpu", "ram"]);
    expect(() => planConsultation({ ...survey, mode: "replacement" })).toThrow("문제를 선택");
    expect(
      planConsultation({
        ...survey,
        mode: "replacement",
        problems: ["gaming"],
        problemNote: "메모리는 충분하고 저장 공간도 괜찮습니다.",
      }).steps,
    ).toEqual(["gpu"]);
  });
  it("allocates the exact total and preserves a user budget override", () => {
    const allocated = allocateBudget(
      { ...survey, budget: 1234567, purposes: ["gaming", "video"] },
      { gpu: 567890 },
    );
    expect(allocated.gpu).toBe(567890);
    expect(Object.values(allocated).reduce((sum, value) => sum + value, 0)).toBe(1234567);
    expect(() => allocateBudget({ ...survey, budget: NaN })).toThrow("전체 예산");
    expect(() => allocateBudget(survey, { gpu: Infinity })).toThrow("배정 금액");
  });
  it("does not treat an omitted existing power supply as verified", () => {
    const result = validateConfiguration(
      { ...survey, mode: "replacement", problems: ["gaming"] },
      { case: part("case-nzxt-h5-flow-2024-white"), gpu: part("gpu-msi-3060-ventus-2x-12g") },
      evidence,
      "gpu",
    );
    expect(result.status).toBe("UNKNOWN");
    expect(result.checks.find((check) => check.code === "PSU_CAPACITY")?.status).toBe("UNKNOWN");
  });
  it("uses CPU_SUPPORT even when the CPU has no socket field", () => {
    const result = validateConfiguration(
      survey,
      {
        cpu: part("verified-cpu-e2017af2302a9f77"),
        motherboard: part("verified-motherboard-1479217d85222ecb"),
      },
      evidence,
      "motherboard",
    );
    expect(result.checks.find((check) => check.code === "CPU_SUPPORT")?.status).toBe("PASS");
  });
  it("reports conditional minimum BIOS and does not present it as unqualified pass", () => {
    const result = validateConfiguration(
      survey,
      { cpu, motherboard: part("mb-b650-tomahawk") },
      evidence,
      "motherboard",
    );
    expect(result.status).toBe("CONDITIONAL");
    expect(result.checks.find((check) => check.code === "CPU_SUPPORT")?.message).toContain(
      "7D75v10",
    );
  });
  it("shows pending future checks without asserting complete compatibility", () => {
    const result = validateConfiguration(survey, { cpu }, evidence, "cpu");
    expect(result.status).toBe("PASS");
    expect(result.checks.every((check) => check.status === "PENDING")).toBe(true);
  });
  it("provides exactly one recommendation on the first passed candidate", () => {
    const result = filterCandidates(fixtureParts, request("cpu"), evidence);
    expect(result.passed.length).toBeGreaterThan(1);
    expect(result.passed.filter((candidate) => candidate.recommended)).toHaveLength(1);
    expect(result.passed[0].recommended).toBe(true);
    expect(result.sortLabel).toContain("판매량 데이터 준비 중");
  });
  it("keeps missing case clearance and unknown coolers out of passed candidates", () => {
    const gpu = part("gpu-msi-3060-ventus-2x-12g");
    const cases = filterCandidates(
      fixtureParts,
      request("case", { motherboard: board, gpu }),
      evidence,
    );
    expect(cases.needsReview.length).toBeGreaterThan(0);
    expect(cases.needsReview.every((candidate) => !candidate.recommended)).toBe(true);
    expect(cases.passed.every((candidate) => candidate.part.specs.max_gpu_length_mm)).toBe(true);
    const coolers = filterCandidates(fixtureParts, request("cooler", { cpu }), evidence);
    expect(coolers.needsReview.length).toBeGreaterThan(0);
  });
  it("excludes insufficient RAM capacity and marks QVL conditions separately", () => {
    const selected = {
      motherboard: part("verified-motherboard-1479217d85222ecb"),
      ram: part("docyx:c613c02e336dea9b10336f5242b307484f0a53a34d188884a49145f712a6b813"),
    };
    expect(validateConfiguration(survey, selected, evidence, "ram").status).toBe("FAIL");
    const qvl = validateConfiguration(
      survey,
      { motherboard: board, ram: part("ram-gskill-f5-6000j3636f32gx2-fx5") },
      evidence,
      "ram",
    );
    expect(qvl.checks.find((check) => check.code === "MEMORY_QVL")?.message).toContain(
      "제조사 검증 목록에 있음",
    );
  });
  it("rejects ATX boards in Mini ITX cases and GPUs longer than known clearance", () => {
    expect(
      validateConfiguration(
        survey,
        {
          motherboard: board,
          case: part("docyx:616060da1b3d3a9b95ad26ccf87d45d0db2f3b6595ccf7c7fe8a566646cdc4d0"),
        },
        evidence,
        "case",
      ).status,
    ).toBe("FAIL");
    const result = validateConfiguration(
      survey,
      {
        case: part("case-fractal-north-black-tg"),
        gpu: part("docyx:7b9666d4e65f8749db9af987e1702bb9810b3346c5d18e590e888477adfa6b25"),
      },
      evidence,
      "case",
    );
    expect(result.checks.find((check) => check.code === "CASE_GPU")?.status).toBe("FAIL");
  });
  it("ignores PSU's null consumption and adds explicit 25% headroom", () => {
    const config = {
      cpu,
      gpu: part("gpu-msi-3060-ventus-2x-12g"),
      psu: part("docyx:e37ac30518a2f66349427c87df67dd645690355c89d062548d79ab4b0cf5c326"),
    };
    const check = validateConfiguration(survey, config, evidence, "psu").checks.find(
      (row) => row.code === "PSU_CAPACITY",
    );
    expect(check?.status).toBe("FAIL");
    expect(check?.message).toContain("294W");
  });
  it("applies remaining budget and actual color specs without inventing missing colors", () => {
    const capped = filterCandidates(
      fixtureParts,
      {
        ...request("cpu", { gpu: part("gpu-msi-3060-ventus-2x-12g") }),
        survey: { ...survey, budget: 410000 },
      },
      evidence,
    );
    expect(capped.passed).toHaveLength(0);
    const white = filterCandidates(fixtureParts, { ...request("case"), color: "흰색" }, evidence);
    expect(
      [...white.passed, ...white.needsReview].every((candidate) =>
        String(candidate.part.specs.color).includes("White"),
      ),
    ).toBe(true);
    const noColor = filterCandidates(fixtureParts, { ...request("cpu"), color: "흰색" }, evidence);
    expect(noColor.missingColorCount).toBeGreaterThan(0);
  });
  it("does not contaminate a RAM candidate with unrelated case or cooler unknowns", () => {
    const result = filterCandidates(fixtureParts, request("ram", { motherboard: board }), evidence);
    expect(result.passed.length).toBeGreaterThan(0);
    expect(result.passed[0].validation.checks.some((check) => check.code === "CASE_GPU")).toBe(
      false,
    );
  });
  it("proposes lower-cost selected parts without mutating the current selection", () => {
    const selected = {
      cpu,
      motherboard: board,
      gpu: part("gpu-msi-3060-ventus-2x-12g"),
      case: part("case-nzxt-h5-flow-2024-black"),
    };
    const snapshot = JSON.stringify(selected);
    const proposal = proposeRebalance(
      fixtureParts,
      evidence,
      { ...request("gpu", selected), survey: { ...survey, budget: 1000000 } },
      650000,
    );
    expect(proposal.allocations.gpu).toBe(650000);
    expect(proposal.afterTotal).toBeLessThanOrEqual(proposal.beforeTotal);
    expect(JSON.stringify(selected)).toBe(snapshot);
    expect(proposal.explanation).toContain("실제 견적은 부품 선택 후");
  });
});
