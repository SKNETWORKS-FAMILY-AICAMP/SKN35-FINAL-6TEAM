import type { CandidateResult } from "./types";

export interface DesignRevision {
  budget?: number;
  cpuBrand?: "Intel" | "AMD";
}

/** Only explicit requests change a design. Comparisons and hypothetical budgets stay in chat. */
export function designRevision(text: string): DesignRevision | null {
  const input = text.normalize("NFKC").trim();
  const hypothetical = /만약|라면|다면|으면|어때|어떨|얼마|비교|가능할까/;
  const negated = /말아|말고\s*싶|하지\s*마|바꾸지|변경하지|안\s*바|싶지\s*않|변경\s*없이/;
  if (hypothetical.test(input) || negated.test(input)) return null;
  const revise =
    /다시\s*(?:견적|설계|짜|구성)|(?:견적|설계|구성)\s*(?:을|를)?\s*(?:다시|짜\s*줘)|재견적|재설계/.test(
      input,
    );
  const amounts = [...input.matchAll(/([\d,]+(?:\.\d+)?)\s*(만|천)?\s*원/g)];
  const revision: DesignRevision = {};
  if (amounts.length === 1 && !/(?:부품|cpu|gpu|그래픽카드|메인보드)\s*예산/i.test(input)) {
    const [match, digits, unit] = amounts[0];
    const prefix = input.slice(0, amounts[0].index);
    const tail = input.slice(amounts[0].index + match.length);
    if (
      (/예산[은는이가을를]?\s*$/.test(prefix) ||
        (revise && (!prefix.trim() || /^(?:으?로|까지)\s*(?:전체\s*)?예산/.test(tail)))) &&
      (revise || /^(?:으로|로|이|가)?\s*(?:되었|됐|바꿔|바꾸|변경|올려|내려)/.test(tail)) &&
      !/^(?:을|를)?\s*(?:더|추가|늘려|올려|줄여)/.test(tail)
    ) {
      const budget =
        Number(digits.replaceAll(",", "")) * (unit === "만" ? 10_000 : unit === "천" ? 1_000 : 1);
      if (Number.isSafeInteger(budget) && budget > 0 && budget <= 1_000_000_000)
        revision.budget = budget;
    }
  }
  const target = input.match(
    /(인텔|intel|amd|에이엠디)(?:\s*(?:cpu|씨피유))?\s*(?:으?로(?:만)?|걸로)\s*(?:다시\s*)?(?:바꾸고\s*싶(?:어요|어)|바꾸자|(?:바꿔|교체해|변경해|구성해|설계해|짜|해)\s*(?:주세요|줘|줄래요?|주라)|(?:재설계|재견적)해\s*줘)(?=$|[\s.!?,])/i,
  );
  if (target && !/(?:gpu|그래픽카드)/i.test(input))
    revision.cpuBrand = /인텔|intel/i.test(target[1]) ? "Intel" : "AMD";
  return revision.budget || revision.cpuBrand ? revision : null;
}

export function cpuCandidates(
  result: CandidateResult,
  brand: DesignRevision["cpuBrand"],
): CandidateResult {
  if (!brand) return result;
  const matches = ({ part }: CandidateResult["passed"][number]) =>
    part.brand?.trim().toLowerCase() === brand.toLowerCase();
  const passed = result.passed.filter(matches);
  const needsReview = result.needsReview.filter(matches);
  return {
    ...result,
    passed,
    needsReview,
    rejectedCount:
      result.rejectedCount +
      result.passed.length +
      result.needsReview.length -
      passed.length -
      needsReview.length,
    criteria: [...result.criteria, `CPU 브랜드: ${brand}`],
  };
}
