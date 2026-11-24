import type {
  BudgetProposal,
  CandidateRequest,
  CandidateResult,
  CatalogSummary,
  Category,
  ConfirmPayload,
  ConsultPlan,
  Part,
  Progress,
  Quote,
  SaveReceipt,
  SelectionMap,
  Survey,
  ValidationResult,
} from "../types";

export interface ConsultDataSource {
  /** 시연 데이터처럼 처음에 읽어 둘 것이 있는 데이터 소스만 구현합니다. */
  initialize?(): Promise<void>;
  getCatalogSummary?(): Promise<CatalogSummary>;
  getDemoSurvey?(): Promise<Survey>;
  searchParts(category: Category, query: string): Promise<Part[]>;
  planConsultation(survey: Survey): Promise<ConsultPlan>;
  getCandidates(
    request: CandidateRequest,
    onProgress?: (progress: Progress) => void,
  ): Promise<CandidateResult>;
  validate(survey: Survey, selected: SelectionMap): Promise<ValidationResult>;
  rebalance(request: CandidateRequest, amount: number): Promise<BudgetProposal>;
  createQuote(input: {
    consultationId: string;
    version: number;
    survey: Survey;
    selected: SelectionMap;
    requestedDiscountPercent?: number;
  }): Promise<Quote>;
  confirmQuote(payload: ConfirmPayload): Promise<SaveReceipt>;
}
