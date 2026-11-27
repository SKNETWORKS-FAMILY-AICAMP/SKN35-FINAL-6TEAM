import {
  CATEGORIES,
  CATEGORY_LABELS,
  won,
  type BudgetProposal,
  type Candidate,
  type CandidateRequest,
  type CandidateResult,
  type Category,
  type CompatibilityRecord,
  type ConsultPlan,
  type HandoffDecision,
  type Part,
  type PartReview,
  type Purpose,
  type SelectionMap,
  type Survey,
  type ValidationCheck,
  type ValidationResult,
} from "../types";
import type { CompanyPolicy } from "./companyPolicy";

/** Company choices are demonstration rules too; the backend must enforce them later. */
export function validateCompanyPolicy(policy: CompanyPolicy): void {
  if (
    !policy.companyCode.trim() ||
    !policy.companyName.trim() ||
    !Number.isInteger(policy.version) ||
    policy.version < 1 ||
    !["price", "brand"].includes(policy.sort) ||
    !Number.isFinite(policy.maxDiscountPercent) ||
    policy.maxDiscountPercent < 0 ||
    policy.maxDiscountPercent > 100 ||
    !Number.isFinite(policy.autoQuoteLimit) ||
    policy.autoQuoteLimit < 0
  )
    throw new Error("기업 정책의 이름·버전·할인 한도·자동 견적 한도를 확인해 주세요.");
}

export function partAllowedByPolicy(part: Part, policy?: CompanyPolicy): boolean {
  const brands = policy?.allowedBrands?.[part.category];
  return !brands || brands.includes(part.brand);
}

export function companyPolicyLabel(policy: CompanyPolicy): string {
  return `${policy.companyName} · 정책 v${policy.version} · 할인 한도 ${policy.maxDiscountPercent}% · 자동 견적 한도 ${won(policy.autoQuoteLimit)}`;
}

export function policyHandoff(
  policy: CompanyPolicy,
  input: {
    validation?: ValidationResult;
    total: number;
    requestedDiscountPercent?: number;
  },
): HandoffDecision {
  const discount = input.requestedDiscountPercent ?? 0;
  if (!Number.isFinite(discount) || discount < 0 || discount > 100)
    throw new Error("요청 할인율을 0~100% 사이의 숫자로 입력해 주세요.");
  const reasons: string[] = [];
  if (discount > policy.maxDiscountPercent)
    reasons.push(`요청 할인 ${discount}%가 기업 한도 ${policy.maxDiscountPercent}%를 넘습니다.`);
  if (input.total > policy.autoQuoteLimit)
    reasons.push(
      `예상 금액 ${won(input.total)}이 자동 견적 한도 ${won(policy.autoQuoteLimit)}를 넘습니다.`,
    );
  const checks = input.validation?.checks ?? [];
  if (
    policy.handoffUnknown &&
    (input.validation?.status === "UNKNOWN" || checks.some((check) => check.status === "UNKNOWN"))
  )
    reasons.push("호환성을 확인할 수 없는 항목은 담당자 확인이 필요합니다.");
  if (
    policy.handoffConditional &&
    (input.validation?.status === "CONDITIONAL" ||
      checks.some((check) => check.status === "CONDITIONAL"))
  )
    reasons.push("조건부 호환 항목은 담당자 확인이 필요합니다.");
  return { required: reasons.length > 0, reasons };
}

/** Apply only to employee responses. Customer text and source evidence stay untouched. */
export function applyResponsePolicy(text: string, policy: CompanyPolicy): string {
  return policy.forbiddenPhrases
    .map((phrase) => phrase.trim())
    .filter(Boolean)
    .reduce((response, phrase) => response.split(phrase).join("담당자 확인 후 안내"), text);
}

/** Same survey for both tenants; every owned part is resolved from the loaded snapshot. */
export function demoSurveyFromParts(parts: Part[], evidence: EvidenceIndex): Survey {
  const survey: Survey = {
    mode: "replacement",
    budget: 500000,
    purposes: ["other"],
    resolution: "fhd",
    frameRate: "60",
    workScale: "basic",
    problems: ["multitasking"],
    problemNote: "기업별 후보와 판매 정책을 비교하는 동일한 시연 설문입니다.",
    owned: {},
  };
  const boards = parts
    .filter((part) => part.category === "motherboard")
    .sort(
      (a, b) =>
        Number(b.source_key === "mb-asus-tuf-gaming-b850-plus-wifi") -
          Number(a.source_key === "mb-asus-tuf-gaming-b850-plus-wifi") ||
        a.source_key.localeCompare(b.source_key),
    );
  const psu = parts.find(
    (part) => part.category === "psu" && (numberSpec(part, "wattage_w") ?? 0) >= 650,
  );
  if (psu) {
    for (const board of boards) {
      const owned = {
        motherboard: { category: "motherboard" as const, name: board.name, part: board },
        psu: { category: "psu" as const, name: psu.name, part: psu },
      };
      const current = { ...survey, owned };
      const candidates = filterCandidates(
        parts,
        {
          survey: current,
          category: "ram",
          selected: {},
          budget: survey.budget,
        },
        evidence,
      );
      const recommended = candidates.passed[0]?.part;
      if (!recommended) continue;
      const candidateKeys = new Set(
        candidates.passed.map((candidate) => candidate.part.source_key),
      );
      const compatibleOwned = parts.filter(
        (part) =>
          part.category === "ram" &&
          part.source_key !== recommended.source_key &&
          validateConfiguration(current, { ram: part }, evidence, "ram").status === "PASS",
      );
      // Prefer a real 8 GB kit below the 16 GB demo target; never invent the old PC's specs.
      const ram =
        compatibleOwned.find((part) => numberSpec(part, "capacity_gb") === 8) ??
        compatibleOwned.find(
          (part) => (numberSpec(part, "capacity_gb") ?? Infinity) < DEMO_RULES.ramGb.basic,
        ) ??
        compatibleOwned.find((part) => !candidateKeys.has(part.source_key)) ??
        compatibleOwned[0];
      if (ram)
        return {
          ...current,
          owned: { ...owned, ram: { category: "ram", name: ram.name, part: ram } },
        };
    }
  }
  return { ...survey, mode: "new", budget: 3000000, problems: [], owned: {} };
}

/** Presentation-only demonstration rules. Replace this module with backend results later.
 * Values are explicit UX scenarios, not measured performance or manufacturer guarantees. */
export const DEMO_RULES = {
  powerHeadroom: 0.25,
  cpuCores: { gaming: 6, image: 6, video: 8, other: 4 },
  gpuVram: { fhd: 6, qhd: 8, "4k": 12 },
  highFrameVramExtra: 2,
  largeWorkCoresExtra: 2,
  ramGb: { basic: 16, large: 32 },
  storageGb: { basic: 500, large: 1000 },
  budgetWeights: {
    gaming: { cpu: 20, motherboard: 13, ram: 10, gpu: 32, storage: 8, cooler: 4, psu: 7, case: 6 },
    image: { cpu: 24, motherboard: 14, ram: 16, gpu: 18, storage: 12, cooler: 4, psu: 7, case: 5 },
    video: { cpu: 25, motherboard: 12, ram: 15, gpu: 23, storage: 11, cooler: 4, psu: 6, case: 4 },
    other: { cpu: 24, motherboard: 16, ram: 13, gpu: 18, storage: 12, cooler: 4, psu: 7, case: 6 },
  } satisfies Record<Purpose, Record<Category, number>>,
  problemTargets: [
    {
      id: "gaming",
      label: "게임이 끊겨요",
      category: "gpu",
      keywords: ["게임", "프레임"],
      reason: "게임 끊김 문제를 바탕으로 GPU 교체 후보를 확인합니다.",
    },
    {
      id: "multitasking",
      label: "여러 프로그램을 띄우면 느려요",
      category: "ram",
      keywords: ["프로그램", "메모리", "멀티"],
      reason: "여러 프로그램을 함께 사용할 때 느려져 RAM 교체 후보를 확인합니다.",
    },
    {
      id: "storage",
      label: "저장 공간이 부족해요",
      category: "storage",
      keywords: ["저장", "용량", "디스크"],
      reason: "저장 공간 부족 문제를 바탕으로 저장장치 교체 후보를 확인합니다.",
    },
    {
      id: "rendering",
      label: "편집·렌더링이 느려요",
      category: "cpu",
      keywords: ["렌더", "편집", "연산"],
      reason: "편집·연산 지연 문제를 바탕으로 CPU 교체 후보를 확인합니다.",
    },
    {
      id: "heat",
      label: "발열과 소음이 커요",
      category: "cooler",
      keywords: ["발열", "소음", "온도"],
      reason: "발열·소음 문제를 바탕으로 쿨러 교체 후보를 확인합니다.",
    },
    {
      id: "power",
      label: "전원이 불안정해요",
      category: "psu",
      keywords: ["전원", "꺼짐", "파워"],
      reason:
        "전원 불안정 문제를 바탕으로 파워 교체 후보를 확인합니다. 원인은 별도 점검이 필요합니다.",
    },
  ] satisfies {
    id: string;
    label: string;
    category: Category;
    keywords: string[];
    reason: string;
  }[],
  caseBoardSupport: {
    "Mini ITX": ["Mini ITX"],
    MicroATX: ["Mini ITX", "Micro ATX"],
    ATX: ["Mini ITX", "Micro ATX", "ATX"],
  } as Record<string, string[]>,
  chunkSize: 64,
} as const;

export const PROBLEM_OPTIONS = DEMO_RULES.problemTargets;
export const PURPOSE_LABELS: Record<Purpose, string> = {
  gaming: "고사양 게임",
  image: "이미지 편집",
  video: "동영상 편집",
  other: "기타",
};
const numberSpec = (part: Part | undefined, key: string): number | undefined => {
  const value = part?.specs[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
};
const stringSpec = (part: Part | undefined, key: string): string | undefined => {
  const value = part?.specs[key];
  return typeof value === "string" && value.trim() ? value : undefined;
};
const price = (part: Part) => part.current_price ?? Number.POSITIVE_INFINITY;
const emptyAllocations = (): Record<Category, number> =>
  Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;

export function effectiveConfiguration(survey: Survey, selected: SelectionMap): SelectionMap {
  const combined: SelectionMap = {};
  if (survey.mode === "replacement") {
    for (const category of CATEGORIES) {
      const owned = survey.owned[category]?.part;
      if (owned) combined[category] = owned;
    }
  }
  return { ...combined, ...selected };
}

export function allocateBudget(
  survey: Survey,
  locked: Partial<Record<Category, number>> = {},
): Record<Category, number> {
  if (!Number.isFinite(survey.budget) || survey.budget <= 0)
    throw new Error("전체 예산을 0원보다 큰 금액으로 입력해 주세요.");
  if (
    Object.values(locked).some(
      (value) => value !== undefined && (!Number.isFinite(value) || value < 0),
    )
  )
    throw new Error("부품 배정 금액을 올바르게 입력해 주세요.");
  const allocations = emptyAllocations();
  const purposes = survey.purposes.length ? survey.purposes : ["other" as const];
  const weights = Object.fromEntries(
    CATEGORIES.map((category) => [
      category,
      purposes.reduce((sum, purpose) => sum + DEMO_RULES.budgetWeights[purpose][category], 0),
    ]),
  ) as Record<Category, number>;
  const open = CATEGORIES.filter((category) => locked[category] === undefined);
  let remaining = Math.max(
    0,
    survey.budget - Object.values(locked).reduce((sum, value) => sum + (value ?? 0), 0),
  );
  const pool = remaining;
  const weight = open.reduce((sum, category) => sum + weights[category], 0);
  for (const category of CATEGORIES)
    if (locked[category] !== undefined) allocations[category] = locked[category]!;
  open.forEach((category, index) => {
    allocations[category] =
      index === open.length - 1 ? remaining : Math.floor((pool * weights[category]) / weight);
    remaining -= allocations[category];
  });
  return allocations;
}

export function planConsultation(survey: Survey): ConsultPlan {
  if (!Number.isFinite(survey.budget) || survey.budget <= 0)
    throw new Error("예산을 0원보다 큰 금액으로 입력해 주세요.");
  const criteria = performanceCriteria(survey);
  if (survey.mode === "new")
    return { steps: [...CATEGORIES], reasons: {}, allocations: allocateBudget(survey), criteria };
  const matched = DEMO_RULES.problemTargets.filter((rule) => survey.problems.includes(rule.id));
  if (!matched.length)
    throw new Error("교체 대상을 정할 수 있도록 지금 겪는 문제를 선택해 주세요.");
  const steps: Category[] = [...new Set(matched.map((rule) => rule.category))];
  const allocations = emptyAllocations();
  steps.forEach((category, index) => {
    allocations[category] =
      index === steps.length - 1
        ? survey.budget - Math.floor(survey.budget / steps.length) * index
        : Math.floor(survey.budget / steps.length);
  });
  return {
    steps,
    reasons: Object.fromEntries(matched.map((rule) => [rule.category, rule.reason])),
    allocations,
    criteria,
  };
}

function floors(survey: Survey) {
  return {
    cores:
      Math.max(
        ...(survey.purposes.length ? survey.purposes : ["other" as const]).map(
          (p) => DEMO_RULES.cpuCores[p],
        ),
      ) + (survey.workScale === "large" ? DEMO_RULES.largeWorkCoresExtra : 0),
    vram:
      DEMO_RULES.gpuVram[survey.resolution] +
      (survey.frameRate === "144" ? DEMO_RULES.highFrameVramExtra : 0),
    ram: DEMO_RULES.ramGb[survey.workScale],
    storage: DEMO_RULES.storageGb[survey.workScale],
  };
}
export function performanceCriteria(survey: Survey): string[] {
  const values = floors(survey);
  return [
    `간이 사양 기준: CPU ${values.cores}코어 이상 · GPU VRAM ${values.vram}GB 이상 · RAM ${values.ram}GB 이상 · 저장장치 ${values.storage}GB 이상`,
    "실제 벤치마크 데이터가 없어 목표 프레임이나 작업 속도를 보장하지 않습니다.",
    `파워 여유분: 선택 부품 소비전력 합계의 ${DEMO_RULES.powerHeadroom * 100}%`,
  ];
}

export type EvidenceIndex = Map<string, CompatibilityRecord[]>;
export function indexEvidence(records: CompatibilityRecord[]): EvidenceIndex {
  const index: EvidenceIndex = new Map();
  for (const record of records) {
    const key = `${record.check_type}|${[record.part_a_key, record.part_b_key].sort().join("|")}`;
    index.set(key, [...(index.get(key) ?? []), record]);
  }
  return index;
}
function evidenceFor(index: EvidenceIndex, type: string, first: Part, second: Part) {
  return index.get(`${type}|${[first.source_key, second.source_key].sort().join("|")}`) ?? [];
}

export function validateConfiguration(
  survey: Survey,
  selected: SelectionMap,
  evidence: EvidenceIndex,
  scope?: Category,
): ValidationResult {
  const config = effectiveConfiguration(survey, selected);
  const checks: ValidationCheck[] = [];
  const add = (code: string, status: ValidationCheck["status"], message: string, source?: string) =>
    checks.push({ code, status, message, ...(source ? { source } : {}) });
  const relates = (...categories: Category[]) => !scope || categories.includes(scope);
  const pair = (code: string, categories: Category[], run: () => void) => {
    if (!relates(...categories)) return;
    const missing = categories.filter((category) => !config[category]);
    if (!missing.length) {
      run();
      return;
    }
    const future =
      scope && survey.mode === "new" && missing.every((category) => !survey.owned[category]);
    add(
      code,
      future ? "PENDING" : "UNKNOWN",
      `${missing.map((category) => CATEGORY_LABELS[category]).join("·")} ${future ? "선택 후 확인합니다." : "정보가 없어 확인할 수 없습니다."}`,
    );
  };
  pair("CPU_SUPPORT", ["cpu", "motherboard"], () => {
    const cpu = config.cpu!,
      board = config.motherboard!;
    const records = evidenceFor(evidence, "CPU_SUPPORT", cpu, board);
    const supported = records.find((record) => record.support_status === "SUPPORTED");
    if (supported) {
      add("CPU_SUPPORT", "PASS", "제조사 CPU 지원 목록에 있습니다.", supported.source_publisher);
      return;
    }
    if (records.length) {
      const bios = [...new Set(records.map((record) => record.min_bios_version).filter(Boolean))];
      add(
        "CPU_SUPPORT",
        "CONDITIONAL",
        bios.length
          ? `최소 BIOS ${bios.join(" / ")} 조건을 확인해 주세요.`
          : "제조사 조건부 지원입니다. 최소 BIOS 정보가 없어 제조사 확인이 필요합니다.",
        [...new Set(records.map((record) => record.source_publisher))].join(", "),
      );
      return;
    }
    const cpuSocket = stringSpec(cpu, "socket"),
      boardSocket = stringSpec(board, "socket");
    if (!cpuSocket || !boardSocket)
      add("CPU_SUPPORT", "UNKNOWN", "CPU 지원 근거 또는 양쪽 소켓 정보가 부족합니다.");
    else
      add(
        "CPU_SUPPORT",
        cpuSocket === boardSocket ? "PASS" : "FAIL",
        `소켓 비교: CPU ${cpuSocket} · 메인보드 ${boardSocket} (제조사 지원 근거 없음)`,
      );
  });
  pair("RAM_COMPATIBILITY", ["motherboard", "ram"], () => {
    const board = config.motherboard!,
      ram = config.ram!;
    const boardType = stringSpec(board, "ram_type"),
      ramType = stringSpec(ram, "ram_type");
    const capacity = numberSpec(ram, "capacity_gb"),
      maximum = numberSpec(board, "ram_max_gb");
    const modules = numberSpec(ram, "modules_per_item"),
      slots = numberSpec(board, "memory_slots");
    if (
      !boardType ||
      !ramType ||
      capacity === undefined ||
      maximum === undefined ||
      modules === undefined ||
      slots === undefined
    )
      add("RAM_COMPATIBILITY", "UNKNOWN", "RAM 규격·용량·모듈 수 정보가 부족합니다.");
    else
      add(
        "RAM_COMPATIBILITY",
        boardType === ramType && capacity <= maximum && modules <= slots ? "PASS" : "FAIL",
        `규격 ${ramType}/${boardType} · 총 용량 ${capacity}/${maximum}GB · 모듈 ${modules}/${slots}개`,
      );
    const qvl = evidenceFor(evidence, "MEMORY_QVL", board, ram);
    if (qvl.length)
      add(
        "MEMORY_QVL",
        qvl.some((record) => record.support_status === "CONDITIONAL") ? "CONDITIONAL" : "PASS",
        "제조사 검증 목록에 있음 · QVL의 메모리 설정 조건을 확인해 주세요.",
        [...new Set(qvl.map((record) => record.source_publisher))].join(", "),
      );
  });
  pair("CASE_BOARD", ["case", "motherboard"], () => {
    const kind = stringSpec(config.case, "type"),
      form = stringSpec(config.motherboard, "form_factor");
    const family = Object.keys(DEMO_RULES.caseBoardSupport).find((prefix) =>
      kind?.startsWith(prefix),
    );
    if (!family || !form || !["ATX", "Micro ATX", "Mini ITX"].includes(form))
      add("CASE_BOARD", "UNKNOWN", "케이스와 메인보드 크기 지원 정보를 추가 확인해 주세요.");
    else
      add(
        "CASE_BOARD",
        DEMO_RULES.caseBoardSupport[family].includes(form) ? "PASS" : "FAIL",
        `케이스 ${kind} · 메인보드 ${form}`,
      );
  });
  pair("CASE_GPU", ["case", "gpu"], () => {
    const clearance = numberSpec(config.case, "max_gpu_length_mm"),
      length = numberSpec(config.gpu, "length_mm");
    if (clearance === undefined || length === undefined)
      add(
        "CASE_GPU",
        "UNKNOWN",
        `${[
          ...(clearance === undefined ? ["케이스의 GPU 허용 길이"] : []),
          ...(length === undefined ? ["GPU 길이"] : []),
        ].join(" · ")} 정보가 없습니다.`,
      );
    else
      add(
        "CASE_GPU",
        length <= clearance ? "PASS" : "FAIL",
        `GPU ${length}mm · 케이스 허용 ${clearance}mm (라디에이터 장착 위치는 별도 확인)`,
      );
  });
  pair("COOLER_SOCKET", ["cooler", "cpu"], () => {
    const sockets = config.cooler!.specs.sockets,
      socket = stringSpec(config.cpu, "socket");
    if (!Array.isArray(sockets) || !socket)
      add(
        "COOLER_SOCKET",
        "UNKNOWN",
        `${[
          ...(!Array.isArray(sockets) ? ["쿨러 지원 소켓"] : []),
          ...(!socket ? ["CPU 소켓"] : []),
        ].join(" · ")} 정보가 없습니다.`,
      );
    else
      add(
        "COOLER_SOCKET",
        sockets.includes(socket) ? "PASS" : "FAIL",
        `쿨러 지원 ${sockets.join(" / ")} · CPU ${socket} (높이·장착 공간 별도 확인)`,
      );
  });
  if (!scope || scope === "psu" || config.psu || survey.mode === "replacement") {
    if (!config.psu)
      add(
        "PSU_CAPACITY",
        scope && survey.mode === "new" ? "PENDING" : "UNKNOWN",
        "파워 선택 후 전력 용량을 확인합니다.",
      );
    else {
      const supply = numberSpec(config.psu, "wattage_w");
      const consumers = Object.values(config).filter((part) => part.category !== "psu");
      const manualUnknown =
        survey.mode === "replacement" &&
        CATEGORIES.some(
          (category) => category !== "psu" && survey.owned[category] && !config[category],
        );
      const incomplete =
        !consumers.length || consumers.some((part) => part.power_draw_w === null) || manualUnknown;
      if (!supply || incomplete)
        add(
          "PSU_CAPACITY",
          "UNKNOWN",
          "선택·보유 부품의 소비전력 또는 파워 정격 정보가 부족합니다.",
        );
      else {
        const total = consumers.reduce((sum, part) => sum + (part.power_draw_w ?? 0), 0);
        const required = Math.ceil(total * (1 + DEMO_RULES.powerHeadroom));
        const estimated = consumers.some((part) => part.power_status === "unconfirmed");
        add(
          "PSU_CAPACITY",
          supply >= required ? "PASS" : "FAIL",
          `소비전력 ${Math.ceil(total)}W${estimated ? " (추정 포함)" : ""} + 여유 ${DEMO_RULES.powerHeadroom * 100}% = ${required}W · 파워 ${supply}W`,
        );
      }
    }
  }
  if (relates("storage") && config.storage)
    add(
      "STORAGE_INTERFACE",
      "UNKNOWN",
      "메인보드 저장장치 포트·슬롯 정보가 없어 연결 규격은 별도 확인이 필요합니다.",
    );
  if (!checks.length)
    add(
      "CURRENT_SCOPE",
      "PASS",
      "현재 단계에서 확인 가능한 간이 조건을 충족합니다. 다른 부품 선택 후 다시 확인합니다.",
    );
  const status = checks.some((check) => check.status === "FAIL")
    ? "FAIL"
    : checks.some((check) => check.status === "UNKNOWN")
      ? "UNKNOWN"
      : checks.some((check) => check.status === "CONDITIONAL")
        ? "CONDITIONAL"
        : "PASS";
  return { status, checks, basis: "demo" };
}

/** Backend replacement point: retain missing evidence per product on a quote. */
export function configurationReviews(
  survey: Survey,
  selected: SelectionMap,
  evidence: EvidenceIndex,
): PartReview[] {
  return Object.values(selected).flatMap((part) => {
    const validation = validateConfiguration(survey, selected, evidence, part.category);
    const reasons = [
      ...new Set(
        validation.checks
          .filter((check) => check.status === "UNKNOWN")
          .map((check) => check.message),
      ),
    ];
    return reasons.length
      ? [{ source_key: part.source_key, category: part.category, reasons }]
      : [];
  });
}

export function eligibleParts(
  parts: Part[],
  request: CandidateRequest,
  policy?: CompanyPolicy,
): { parts: Part[]; missingColorCount: number } {
  if (
    !Number.isFinite(request.survey.budget) ||
    request.survey.budget <= 0 ||
    !Number.isFinite(request.budget) ||
    request.budget < 0
  )
    throw new Error("전체 예산과 부품 예산을 올바르게 입력해 주세요.");
  const target = floors(request.survey);
  const selectedOtherTotal = Object.values(request.selected)
    .filter((part) => part.category !== request.category)
    .reduce((sum, part) => sum + (part.current_price ?? 0), 0);
  const budget = Math.min(request.budget, Math.max(0, request.survey.budget - selectedOtherTotal));
  let missingColorCount = 0;
  const eligible = parts.filter((part) => {
    if (
      !partAllowedByPolicy(part, policy) ||
      part.category !== request.category ||
      (part.category === "cpu" &&
        request.cpuBrand &&
        part.brand.toLowerCase() !== request.cpuBrand.toLowerCase()) ||
      (request.survey.mode === "replacement" &&
        part.source_key === request.survey.owned[request.category]?.part?.source_key) ||
      part.current_price === null ||
      !Number.isFinite(part.current_price) ||
      part.current_price > budget
    )
      return false;
    const lower =
      part.category === "cpu"
        ? (["cores", target.cores] as const)
        : part.category === "gpu"
          ? (["vram_gb", target.vram] as const)
          : part.category === "ram"
            ? (["capacity_gb", target.ram] as const)
            : part.category === "storage"
              ? (["capacity_gb", target.storage] as const)
              : undefined;
    if (lower && (numberSpec(part, lower[0]) ?? -1) < lower[1]) return false;
    if (request.color?.trim()) {
      const color = stringSpec(part, "color");
      if (!color) {
        missingColorCount++;
        return false;
      }
      const requested = request.color
        .trim()
        .toLowerCase()
        .replace("흰색", "white")
        .replace("검은색", "black");
      if (!color.toLowerCase().includes(requested)) return false;
    }
    return true;
  });
  return {
    parts: eligible.sort((a, b) => price(a) - price(b) || a.source_key.localeCompare(b.source_key)),
    missingColorCount,
  };
}

export function candidateFor(
  part: Part,
  request: CandidateRequest,
  evidence: EvidenceIndex,
): Candidate {
  return {
    part,
    validation: validateConfiguration(
      request.survey,
      { ...request.selected, [request.category]: part },
      evidence,
      request.category,
    ),
    recommended: false,
    reason: "",
  };
}
export function finishCandidates(
  candidates: Candidate[],
  request: CandidateRequest,
  missingColorCount: number,
  policy?: CompanyPolicy,
): CandidateResult {
  const passed = candidates.filter((candidate) =>
    ["PASS", "CONDITIONAL"].includes(candidate.validation.status),
  );
  // Missing evidence is never a recommendation, including under a brand-first company policy.
  const needsReview = candidates
    .filter((candidate) => candidate.validation.status === "UNKNOWN")
    .map((candidate) => ({ ...candidate, recommended: false, reason: "" }))
    .sort(
      (a, b) => price(a.part) - price(b.part) || a.part.source_key.localeCompare(b.part.source_key),
    );
  if (policy) {
    const rank = (part: Part) => {
      const index = policy.preferredBrands.indexOf(part.brand);
      return index < 0 ? policy.preferredBrands.length : index;
    };
    const compare = (a: Candidate, b: Candidate) =>
      (policy.sort === "brand" ? rank(a.part) - rank(b.part) : 0) ||
      price(a.part) - price(b.part) ||
      a.part.source_key.localeCompare(b.part.source_key);
    passed.sort(compare);
  }
  if (passed.length)
    passed[0] = {
      ...passed[0],
      recommended: true,
      reason:
        policy?.sort === "brand"
          ? "검증 통과 후보에 기업의 선호 브랜드 순서와 가격 낮은 순을 적용했습니다."
          : "통과한 후보 중 가장 저렴합니다. 조건부 항목은 조건을 확인해 주세요.",
    };
  return {
    passed,
    needsReview,
    rejectedCount: candidates.filter((candidate) => candidate.validation.status === "FAIL").length,
    missingColorCount,
    sortLabel:
      policy?.sort === "brand"
        ? `추천 기준: 선호 브랜드 순 (${policy.preferredBrands.join(" → ") || "지정 없음"}), 같은 우선순위는 가격 낮은 순 (판매량 데이터 준비 중)`
        : request.survey.mode === "new"
          ? "추천 기준: 가격 낮은 순 (판매량 데이터 준비 중)"
          : "추천 기준: 가격 낮은 순",
    criteria: [
      ...performanceCriteria(request.survey),
      `이 부품 예산: ${won(request.budget)}`,
      ...(request.survey.mode === "replacement" && request.survey.owned[request.category]?.part
        ? ["이미 보유한 동일 제품은 교체 후보에서 제외합니다."]
        : []),
      ...(request.note?.trim()
        ? [`추가 요청: ${request.note} · 자유 입력 조건은 자동 판정하지 않습니다.`]
        : []),
    ],
    basis: "demo",
    ...(policy
      ? {
          policyLabel: companyPolicyLabel(policy),
          handoff: policyHandoff(policy, {
            validation: (passed[0] ?? needsReview[0])?.validation,
            total:
              Object.values(request.selected)
                .filter((part) => part.category !== request.category)
                .reduce((sum, part) => sum + price(part), 0) +
              ((passed[0] ?? needsReview[0])?.part.current_price ?? 0),
            requestedDiscountPercent: request.requestedDiscountPercent,
          }),
        }
      : {}),
  };
}
export function filterCandidates(
  parts: Part[],
  request: CandidateRequest,
  evidence: EvidenceIndex,
  policy?: CompanyPolicy,
): CandidateResult {
  const eligible = eligibleParts(parts, request, policy);
  return finishCandidates(
    eligible.parts.map((part) => candidateFor(part, request, evidence)),
    request,
    eligible.missingColorCount,
    policy,
  );
}

export function proposeRebalance(
  parts: Part[],
  evidence: EvidenceIndex,
  request: CandidateRequest,
  amount: number,
  policy?: CompanyPolicy,
): BudgetProposal {
  if (!Number.isFinite(amount) || amount <= 0)
    throw new Error("배정 금액을 0원보다 큰 숫자로 입력해 주세요.");
  const allocations = allocateBudget(request.survey, { [request.category]: amount });
  const selected = { ...request.selected };
  const otherTotal = () =>
    Object.values(selected)
      .filter((part) => part.category !== request.category)
      .reduce((sum, part) => sum + price(part), 0);
  const unselectedAllowance = CATEGORIES.filter(
    (category) => category !== request.category && !selected[category],
  ).reduce((sum, category) => sum + allocations[category], 0);
  const beforeTotal = amount + otherTotal() + unselectedAllowance;
  const alternatives: BudgetProposal["alternatives"] = [];
  const chosenOthers = Object.values(selected)
    .filter((part) => part.category !== request.category)
    .sort((a, b) => price(b) - price(a));
  for (const before of chosenOthers) {
    if (amount + otherTotal() + unselectedAllowance <= request.survey.budget) break;
    const replacementRequest = {
      ...request,
      category: before.category,
      color: undefined,
      budget: Math.max(0, price(before) - 1),
      selected,
    };
    const result = filterCandidates(parts, replacementRequest, evidence, policy);
    const candidate = result.passed[0];
    if (!candidate) continue;
    selected[before.category] = candidate.part;
    alternatives.push({
      category: before.category,
      before,
      after: candidate.part,
      validation: candidate.validation,
    });
  }
  const afterTotal = amount + otherTotal() + unselectedAllowance;
  return {
    alternatives,
    beforeTotal,
    afterTotal,
    allocations,
    feasible: afterTotal <= request.survey.budget,
    explanation: `비교 총액은 요청한 ${CATEGORY_LABELS[request.category]} 예산 ${won(amount)} + 다른 선택 부품 가격 + 미선택 부품 배정액입니다. 실제 견적은 부품 선택 후 계산합니다.${afterTotal > request.survey.budget ? " 현재 자료에서 예산에 맞는 검증 통과 대체안을 찾지 못했습니다." : " 대체 부품은 수락할 때만 반영됩니다."}`,
  };
}
