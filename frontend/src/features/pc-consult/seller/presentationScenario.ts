import type { SellerMenu } from "./types";

export const PRESENTATION_STEPS: {
  title: string;
  description: string;
  seconds: number;
  menu: SellerMenu;
  tab?: "connection" | "policy" | "compare";
}[] = [
  {
    title: "기업 가입과 AI 팀",
    description: "시연 가입으로 들어온 회사의 AI 상담팀과 사람의 역할을 소개합니다.",
    seconds: 20,
    menu: "home",
  },
  {
    title: "상품 DB 연결 확인",
    description: "실제 스냅샷에서 읽은 상품 수, 분류, 제조사 호환성 근거를 확인합니다.",
    seconds: 20,
    menu: "catalog",
    tab: "connection",
  },
  {
    title: "우리 회사 정책",
    description: "가격·브랜드 우선순위와 할인 자동 응대 한도를 설정합니다.",
    seconds: 20,
    menu: "catalog",
    tab: "policy",
  },
  {
    title: "손님 상담과 팀 작업",
    description: "발표용 설문을 불러오고 상담을 시작하세요. 실제 계산을 따라 사무실이 움직입니다.",
    seconds: 35,
    menu: "preview",
  },
  {
    title: "사람에게 인계",
    description: "고객 미리보기의 인계 버튼으로 넘긴 상담에서 이유·대화·팀 기록을 확인합니다.",
    seconds: 25,
    menu: "issues",
  },
  {
    title: "피드백에서 정책 개선",
    description: "할인 문의 분석에서 정책 검토로 이동해 한도를 바꿔 저장합니다.",
    seconds: 25,
    menu: "feedback",
  },
  {
    title: "같은 상담 다시 실행",
    description: "같은 설문으로 다시 실행한 뒤 상담을 시작해 인계 판단과 추천의 차이를 확인합니다.",
    seconds: 35,
    menu: "preview",
  },
];
export function presentationStep(index: number, direction: 1 | -1) {
  return Math.min(PRESENTATION_STEPS.length - 1, Math.max(0, index + direction));
}
