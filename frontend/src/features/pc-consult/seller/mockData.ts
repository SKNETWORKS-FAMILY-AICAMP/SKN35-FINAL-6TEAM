import type { AgentEvent } from "../../../api/client";
import type { Customer, SellerState } from "./types";

/** Entirely synthetic seller-workspace demonstration data. No real customers, sales, or accounts. */
export const DEMO_COMPANIES = [
  { code: "BW-1001", name: "가상전자" },
  { code: "BW-2002", name: "테스트컴퓨터" },
] as const;
export const DEMO_DATE = "2026-11-18";
export const DEMO_TIME = "14:30";
/** Synthetic daily cohort; completed = automatically resolved + handed off. */
export const B2B_METRICS = {
  label: "오늘 · 가상 성과 집계",
  consultations: 10,
  completed: 4,
  automaticallyResolved: 2,
  handedOff: 2,
  quoted: 3,
  averageResponseSeconds: 18,
} as const;

/** Initial synthetic receipts describe data already loaded, never an unfinished consultation. */
export function initialSellerEvents(companyCode: string, state: SellerState): AgentEvent[] {
  const jobs = [
    {
      team: "design" as const,
      message: `가상 상담 자료 ${state.documents.length}건을 준비했습니다.`,
    },
    {
      team: "consultation" as const,
      message: `가상 고객 기록 ${state.customers.length}건을 준비했습니다.`,
    },
  ];
  return jobs.flatMap((job, index) =>
    [false, true].map((completed, step) => ({
      seq: index * 2 + step + 1,
      session_id: `seller-demo-seed:${companyCode}`,
      company_id: 0,
      run_id: `seller-demo-seed:${companyCode}`,
      requirement_version: 1,
      team: job.team,
      type: completed ? ("task.completed" as const) : ("task.started" as const),
      status: completed ? ("completed" as const) : ("running" as const),
      occurred_at: `${DEMO_DATE}T${DEMO_TIME}:00+09:00`,
      message: `${completed ? job.message : "시연 기록을 불러오고 있습니다."} (가상 초기 기록 · 시연)`,
      error: null,
      artifact: null,
      metrics: null,
    })),
  );
}

/** Synthetic customer feedback only. These are not observations from actual customers. */
export const FEEDBACK_DEMO = {
  intents: [
    { label: "새 PC 구성", value: 20 },
    { label: "부품 교체", value: 16 },
    { label: "배송·AS 문의", value: 8 },
    { label: "할인 한도 문의", value: 6 },
  ],
  conditions: [
    { label: "예산 우선", value: 22 },
    { label: "작업 성능", value: 18 },
    { label: "색상·크기", value: 10 },
  ],
  complaints: [
    { label: "배송 안내 부족", value: 6 },
    { label: "호환성 정보 부족", value: 4 },
    { label: "AS 기준 확인", value: 3 },
  ],
  dropoffs: [
    { label: "예산 입력", value: 5 },
    { label: "후보 비교", value: 4 },
    { label: "견적 확인", value: 3 },
  ],
  handoffs: [
    { label: "정책 확인 필요", value: 4 },
    { label: "부품 정보 부족", value: 4 },
    { label: "고객 직접 요청", value: 2 },
  ],
  actions: [
    {
      id: "demo-feedback-discount",
      kind: "요청" as const,
      topic: "할인 한도 안내",
      message: "가상 고객 피드백: 적용 가능한 할인 한도와 담당자 확인 기준을 알고 싶어요.",
      count: 6,
      action: "catalog" as const,
      actionLabel: "할인 정책 한도 검토",
    },
    {
      id: "demo-feedback-shipping",
      kind: "불만" as const,
      topic: "배송 안내",
      message: "가상 고객 피드백: 출고 예정일을 상담에서 먼저 확인하고 싶어요.",
      count: 6,
      action: "documents" as const,
      actionLabel: "배송 정책 확인",
    },
    {
      id: "demo-feedback-compatibility",
      kind: "요청" as const,
      topic: "부품 호환성 정보",
      message: "가상 고객 피드백: 지원 소켓과 케이스 크기 정보를 더 보고 싶어요.",
      count: 4,
      action: "documents" as const,
      actionLabel: "상품 정보 보강 요청",
    },
    {
      id: "demo-feedback-service",
      kind: "요청" as const,
      topic: "AS 안내",
      message: "가상 고객 피드백: 교환과 AS 조건을 한곳에서 확인하고 싶어요.",
      count: 3,
      action: "documents" as const,
      actionLabel: "AS 정책 확인",
    },
  ],
};
export const DEMO_SCRIPT = {
  bubbles: [
    "안녕하세요. 영상 편집용 PC를 찾고 있어요.",
    "예산과 작업 규모를 확인하겠습니다.",
    "검토할 구성과 상담 내용을 정리하고 있습니다.",
  ],
  handoff: "상담 내용을 인계 에이전트에게 전달하고 있습니다.",
  summary: {
    request: "영상 편집용 PC 구성 · 예산 150만 원",
    recommendation: "가상 편집용 PC 구성과 메모리 확장을 안내했습니다.",
    attention: "실제 상품 추천과 호환성 검증은 연동 예정입니다.",
  },
  claim: {
    title: "시연 주문의 배송 일정 확인 요청",
    summary: "고객이 배송 예정일과 주문 상태 확인을 요청했습니다.",
    suggestion: "담당자를 배정하고 배송 정책과 주문 상태를 확인해 주세요.",
  },
  abuse: "*** 표현이 감지되었습니다. 담당자의 확인이 필요합니다.",
  completed: "담당자가 시연 이슈를 처리했습니다.",
};
export const salesPeriods = {
  day: {
    label: "일간",
    multiplier: 1,
    labels: ["09시", "11시", "13시", "15시", "17시", "19시"],
    trendWeights: [0.08, 0.14, 0.22, 0.18, 0.25, 0.13],
    quoteCount: 30,
    purchaseCount: 18,
  },
  week: {
    label: "주간",
    multiplier: 7,
    labels: ["월", "화", "수", "목", "금", "토", "일"],
    trendWeights: [0.12, 0.13, 0.14, 0.17, 0.19, 0.16, 0.09],
    quoteCount: 182,
    purchaseCount: 119,
  },
  month: {
    label: "월간",
    multiplier: 30,
    labels: ["1주", "2주", "3주", "4주"],
    trendWeights: [0.18, 0.24, 0.27, 0.31],
    quoteCount: 760,
    purchaseCount: 492,
  },
} as const;

export function initialSellerState(companyCode = DEMO_COMPANIES[0].code as string): SellerState {
  const prefix = companyCode === "BW-2002" ? "demo-b" : "demo-a";
  const id = (kind: string, index: number) => `${prefix}-${kind}-${index}`;
  const kinds: Customer["kind"][] = ["개인", "학생", "스타트업", "연구실"];
  const customers: SellerState["customers"] = Array.from({ length: 20 }, (_, index) => ({
    id: id("customer", index + 1),
    name: `시연 고객 ${String(index + 1).padStart(2, "0")}`,
    kind: kinds[index % kinds.length],
    lastConsulted: `${DEMO_DATE} ${String(9 + (index % 8)).padStart(2, "0")}:20`,
    blocked: index >= 18,
    blockReason: index >= 18 ? "시연: 반복적인 상담 방해" : "",
    blockedBy: index >= 18 ? "가상관리" : "",
    blockedAt: index >= 18 ? `${DEMO_DATE} 09:00` : "",
  }));
  // sales is a synthetic daily quantity. The 30 customer quotes below are a separate sample history.
  const parts: SellerState["parts"] = [
    {
      id: id("part", 1),
      name: "가상 RTX 4070급 그래픽카드",
      category: "GPU",
      price: 650000,
      sales: 42,
      demand: 82,
    },
    {
      id: id("part", 2),
      name: "가상 8코어 프로세서",
      category: "CPU",
      price: 310000,
      sales: 35,
      demand: 76,
    },
    {
      id: id("part", 3),
      name: "가상 DDR5 32GB 메모리",
      category: "RAM",
      price: 120000,
      sales: 63,
      demand: 91,
    },
    {
      id: id("part", 4),
      name: "가상 NVMe 1TB 저장장치",
      category: "SSD",
      price: 95000,
      sales: 58,
      demand: 88,
    },
    {
      id: id("part", 5),
      name: "가상 ATX 메인보드",
      category: "메인보드",
      price: 180000,
      sales: 26,
      demand: 58,
    },
    {
      id: id("part", 6),
      name: "가상 750W 파워서플라이",
      category: "PSU",
      price: 110000,
      sales: 31,
      demand: 65,
    },
    {
      id: id("part", 7),
      name: "가상 크리에이터 노트북",
      category: "노트북",
      price: 1590000,
      sales: 14,
      demand: 47,
    },
    {
      id: id("part", 8),
      name: "가상 DDR5 64GB 메모리",
      category: "RAM",
      price: 230000,
      sales: 19,
      demand: 54,
    },
    {
      id: id("part", 9),
      name: "가상 NVMe 2TB 저장장치",
      category: "SSD",
      price: 170000,
      sales: 24,
      demand: 63,
    },
    {
      id: id("part", 10),
      name: "가상 RTX 4060급 그래픽카드",
      category: "GPU",
      price: 390000,
      sales: 37,
      demand: 72,
    },
  ];
  const quotes: SellerState["quotes"] = Array.from({ length: 30 }, (_, index) => {
    const chosen = [parts[index % parts.length], parts[(index + 2) % parts.length]];
    const items = chosen.map((part) => ({ name: part.name, price: part.price, quantity: 1 }));
    return {
      id: id("quote", index + 1),
      customerId: customers[index % customers.length].id,
      date: `${index < 10 ? DEMO_DATE : "2026-11-17"} 10:30`,
      total: items.reduce((total, item) => total + item.price * item.quantity, 0),
      items,
    };
  });
  const consultations: SellerState["consultations"] = Array.from({ length: 40 }, (_, index) => ({
    id: id("chat", index + 1),
    customerId: customers[index % customers.length].id,
    date: `${index < 10 ? DEMO_DATE : "2026-11-17"} 11:20`,
    lines: [
      { speaker: "고객", text: "영상 편집에 쓸 PC 구성을 상담하고 싶어요." },
      { speaker: "상담 에이전트", text: "사용 목적과 예산을 확인하겠습니다." },
      { speaker: "고객", text: "예산은 150만 원이고 작업 파일이 많아요." },
    ],
    summary: index < 6 ? null : { ...DEMO_SCRIPT.summary },
  }));
  return {
    customers,
    quotes,
    consultations,
    parts,
    issues: Array.from({ length: 8 }, (_, index) => ({
      id: id("issue", index + 1),
      customerId: customers[index + 2].id,
      kind: (["이슈", "클레임", "오류"] as const)[index % 3],
      title: [
        "시연 배송 일정 확인",
        "시연 견적 변경 요청",
        "시연 상품 문의",
        "시연 상담 연결 확인",
      ][index % 4],
      stage: (["received", "classified", "working", "done"] as const)[index % 4],
      assignee: index % 4 >= 2 ? "가상상담A" : "미배정",
      summary: "시연 고객의 요청을 담당자가 확인하고 있습니다.",
      suggestion: "상담 기록과 기업 정책을 확인해 주세요.",
    })),
    employees: [
      { id: id("employee", 1), name: "가상관리", role: "admin", status: "active" },
      { id: id("employee", 2), name: "가상상담A", role: "agent", status: "active" },
      { id: id("employee", 3), name: "가상상담B", role: "agent", status: "active" },
      { id: id("employee", 4), name: "가상상담C", role: "agent", status: "active" },
      { id: id("employee", 5), name: "가상신청D", role: "agent", status: "pending" },
    ],
    documents: [
      {
        id: id("document", 1),
        title: "시연 상품 안내서.pdf",
        kind: "상품 안내",
        updatedAt: `${DEMO_DATE} 09:00`,
        reflected: true,
      },
      {
        id: id("document", 2),
        title: "시연 배송 정책.pdf",
        kind: "배송 정책",
        updatedAt: `${DEMO_DATE} 09:10`,
        reflected: true,
      },
      {
        id: id("document", 3),
        title: "시연 기업 공지.pdf",
        kind: "공지",
        updatedAt: `${DEMO_DATE} 09:20`,
        reflected: true,
      },
      {
        id: id("document", 4),
        title: "시연 자주 묻는 질문.pdf",
        kind: "FAQ",
        updatedAt: `${DEMO_DATE} 09:30`,
        reflected: true,
      },
      {
        id: id("document", 5),
        title: "시연 AS 안내.pdf",
        kind: "AS 정책",
        updatedAt: `${DEMO_DATE} 09:40`,
        reflected: true,
      },
    ],
    alerts: [],
    feed: [
      { id: 1, text: "기업 상담 시연 작업공간이 준비되었습니다.", time: DEMO_TIME, menu: "home" },
    ],
    todayConsultations: 10,
    todaySales: parts.reduce((sum, part) => sum + part.sales, 0),
    activeConsultations: 3,
    waitingConsultations: 3,
    completedConsultations: 4,
    office: {
      phase: "idle",
      consultationId: consultations[0].id,
      customerId: customers[0].id,
      bubble: "상담 에이전트가 고객의 요청을 기다리고 있습니다.",
      issueId: null,
      log: [],
    },
    shippingFee: 3000,
    discount: 5,
    unread: [],
    menu: "home",
    toast: "",
    toastId: 0,
    uploadProgress: null,
    scenarioRunning: false,
    policyVersion: 0,
  };
}
