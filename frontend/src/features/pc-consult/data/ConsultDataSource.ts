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
  initialize(): Promise<void>;
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
