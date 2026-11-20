import type { ConsultDataSource } from "./ConsultDataSource";

const unavailable = async (): Promise<never> => {
  throw new Error("PC 상담 API가 아직 연결되지 않았습니다. 스냅샷 시연으로 이용해 주세요.");
};

/** Reserved adapter: API_PROPOSAL.md requires a separate backend contract review. */
export const apiSource: ConsultDataSource = {
  initialize: unavailable,
  searchParts: unavailable,
  planConsultation: unavailable,
  getCandidates: unavailable,
  validate: unavailable,
  rebalance: unavailable,
  createQuote: unavailable,
  confirmQuote: unavailable,
};
