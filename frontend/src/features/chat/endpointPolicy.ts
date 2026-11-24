/**
 * 말 끝 판정: 받아쓴 글을 보고 침묵을 얼마나 더 기다릴지 정합니다.
 * 규칙 기반 첫 판이고, 학습한 턴 종료 분류기가 나중에 같은 모양(EndpointPolicy)으로 들어옵니다.
 * 판단은 마지막 어절 하나로 합니다. 문장 중간의 "요"(제가요, 노트북을요)는 앞 어절이라 영향이 없습니다.
 */

export type EndpointRule = "final" | "continuation" | "filler" | "short" | "default";

export interface EndpointDecision {
  delayMs: number;
  rule: EndpointRule;
}

export type EndpointPolicy = (text: string) => EndpointDecision;

/** 끝맺은 말. Chrome 확정 결과가 늦게 오는 만큼 짧게 잡지 않고 550ms 에서 시작합니다. */
export const FINAL_DELAY_MS = 550;
/** 말이 이어질 조짐(조사·연결어미·채움말). */
export const CONTINUATION_DELAY_MS = 1400;
/** 판단이 안 서는 말과 짧은 말. */
export const DEFAULT_DELAY_MS = 800;
/** 이보다 짧은 말은 규칙을 믿지 않고 기본값을 씁니다. */
const MIN_SYLLABLES = 6;

/** 어절 전체가 이것일 때만 채움말로 봅니다("그래픽카드"의 "그"는 아님). */
const FILLERS = new Set([
  "음",
  "음음",
  "으음",
  "어",
  "어어",
  "그",
  "저",
  "아",
  "에",
  "그러니까",
  "그니까",
  "뭐랄까",
  "근데",
  "그리고",
  "그래서",
  "그러면",
  "그럼",
  "아니면",
  "혹시",
]);

/** 끝맺음 어미. 길게 맞는 것부터 봅니다. */
const FINAL_SUFFIXES = ["니다", "세요", "까요", "나요", "죠", "요", "다", "줘", "냐", "네"];
/** 끝맺음처럼 보이지만 명사인 어절. 끝맺음으로 치지 않습니다. */
const NOUNS_ENDING_LIKE_FINAL = new Set(["필요", "중요", "주요", "수요", "개요", "판다", "혼다"]);
/** 앞 음절 받침이 ㄹ 일 때만 끝맺음인 것: 할게 · 볼래 · 될까 · 좋을걸. "미래", "니까"는 아님. */
const RIEUL_FINALS = ["게", "래", "까", "걸"];
/** 그대로 끝맺음인 권유형. "개발자", "사용자"는 아님. */
const SUGGESTIONS = new Set(["하자", "보자", "가자", "사자", "그러자"]);
/** 띄어 쓴 보조 용언 한 글자로 끝나는 말: "맞춰 줘", "이걸로 해", "괜찮아 돼". */
const STANDALONE_FINALS = new Set(["줘", "해", "돼", "봐"]);

/** 말이 이어질 조짐. 어절이 이것보다 길 때만 봅니다(어절 하나짜리 "이", "가"는 아님). */
const CONTINUATION_SUFFIXES = [
  "에서",
  "으로",
  "이랑",
  "하고",
  "는데",
  "은데",
  "지만",
  "니까",
  "거나",
  "든지",
  "려고",
  "도록",
  "은",
  "는",
  "이",
  "가",
  "을",
  "를",
  "에",
  "로",
  "랑",
  "와",
  "과",
  "도",
  "만",
  "의",
  "고",
  "면",
];

const HANGUL_START = 0xac00;
const HANGUL_END = 0xd7a3;
const RIEUL_JONG = 8;

/** 한글 음절의 받침 번호. 한글이 아니면 null, 받침이 없으면 0. */
function finalConsonant(syllable: string | undefined): number | null {
  if (!syllable) return null;
  const code = syllable.charCodeAt(0);
  if (code < HANGUL_START || code > HANGUL_END) return null;
  return (code - HANGUL_START) % 28;
}

function hasRieulFinal(syllable: string | undefined): boolean {
  return finalConsonant(syllable) === RIEUL_JONG;
}

function syllableCount(text: string): number {
  let count = 0;
  for (const char of text) if (/[\p{L}\p{N}]/u.test(char)) count++;
  return count;
}

/** 끝 구두점·물결·말줄임을 걷어 냅니다. Chrome 한국어 결과에는 물음표가 거의 붙지 않습니다. */
function trimTail(text: string): string {
  return text.replace(/[\s.,!?~…·"'”’)\]]+$/u, "");
}

function isFinal(word: string): boolean {
  if (STANDALONE_FINALS.has(word)) return true;
  if (NOUNS_ENDING_LIKE_FINAL.has(word) || SUGGESTIONS.has(word)) return SUGGESTIONS.has(word);
  if (FINAL_SUFFIXES.some((suffix) => word.length > suffix.length && word.endsWith(suffix)))
    return true;
  const chars = [...word];
  const last = chars.at(-1);
  return (
    chars.length >= 2 && RIEUL_FINALS.includes(last ?? "") && hasRieulFinal(chars.at(-2) ?? "")
  );
}

function isContinuation(word: string): boolean {
  if (CONTINUATION_SUFFIXES.some((suffix) => word.length > suffix.length && word.endsWith(suffix)))
    return true;
  // 연결어미 "-서"(해서, 걸려서, 와서)는 앞 음절에 받침이 없습니다. "견적서", "순서"는 받침이 있어 빠집니다.
  const chars = [...word];
  return chars.length >= 2 && chars.at(-1) === "서" && finalConsonant(chars.at(-2)) === 0;
}

export const endpointDelay: EndpointPolicy = (text) => {
  const trimmed = trimTail(text.trim());
  const words = trimmed.split(/\s+/u).filter(Boolean);
  const last = words.at(-1) ?? "";
  if (last && FILLERS.has(last)) return { delayMs: CONTINUATION_DELAY_MS, rule: "filler" };
  if (syllableCount(trimmed) < MIN_SYLLABLES) return { delayMs: DEFAULT_DELAY_MS, rule: "short" };
  if (isFinal(last)) return { delayMs: FINAL_DELAY_MS, rule: "final" };
  if (isContinuation(last)) return { delayMs: CONTINUATION_DELAY_MS, rule: "continuation" };
  return { delayMs: DEFAULT_DELAY_MS, rule: "default" };
};

/** 시험과 예전 동작용 고정 대기. */
export function fixedEndpoint(delayMs: number): EndpointPolicy {
  return () => ({ delayMs, rule: "default" });
}
