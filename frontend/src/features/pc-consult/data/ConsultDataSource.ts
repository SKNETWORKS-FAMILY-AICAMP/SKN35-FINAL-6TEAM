import type {
  BudgetProposal,
  CandidateRequest,
  CandidateResult,
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
  }): Promise<Quote>;
  confirmQuote(payload: ConfirmPayload): Promise<SaveReceipt>;
}
