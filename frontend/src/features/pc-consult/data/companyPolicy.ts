import type { Category } from "../types";

/** Browser demonstration policies, not actual company rules or inventory claims. */
export interface CompanyPolicy {
  companyCode: string;
  companyName: string;
  version: number;
  sort: "price" | "brand";
  preferredBrands: string[];
  allowedBrands?: Partial<Record<Category, string[]>>;
  maxDiscountPercent: number;
  handoffUnknown: boolean;
  handoffConditional: boolean;
  autoQuoteLimit: number;
  forbiddenPhrases: string[];
}

/** Brand names below are present in the supplied snapshot; no stock or sales are inferred. */
export const DEFAULT_COMPANY_POLICIES: Record<string, CompanyPolicy> = {
  "BW-1001": {
    companyCode: "BW-1001",
    companyName: "가상전자",
    version: 1,
    sort: "price",
    preferredBrands: ["Corsair", "ASUS", "Intel"],
    maxDiscountPercent: 3,
    handoffUnknown: true,
    handoffConditional: true,
    autoQuoteLimit: 2000000,
    forbiddenPhrases: ["최저가 보장", "무조건 호환", "성능 보장"],
  },
  "BW-2002": {
    companyCode: "BW-2002",
    companyName: "테스트컴퓨터",
    version: 1,
    sort: "brand",
    preferredBrands: ["G.Skill", "AMD", "MSI", "Kingston"],
    allowedBrands: { cpu: ["AMD"], ram: ["G.Skill", "Kingston"] },
    maxDiscountPercent: 7,
    handoffUnknown: true,
    handoffConditional: false,
    autoQuoteLimit: 3000000,
    forbiddenPhrases: ["최저가 보장", "무조건 호환", "성능 보장"],
  },
};
