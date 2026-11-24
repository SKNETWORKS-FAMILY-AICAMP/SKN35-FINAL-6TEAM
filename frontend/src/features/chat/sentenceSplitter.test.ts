import { describe, expect, it } from "vitest";
import {
  MAX_SENTENCE_CHARS,
  MIN_SENTENCE_CHARS,
  createSentenceSplitter,
  speakable,
  splitSentences,
} from "./sentenceSplitter";

const REPLY =
  "지금 조합이면 게임과 실습 둘 다 무리 없어요. 그래픽카드는 RTX 4070 SUPER 이고 부스트 클럭은 2.5GHz 입니다. " +
  "CPU 는 i7-13700H 기준으로 봤어요! 총액은 1,500,000원이에요. 네. 가격은 테스트 가격이라 확인이 필요해요?\n" +
  "1. 그래픽카드 메모리 확인\n2. 파워 정격 확인";

describe("splitSentences", () => {
  it("splits on sentence punctuation and newlines but not inside numbers or model names", () => {
    expect(splitSentences(REPLY)).toEqual([
      "지금 조합이면 게임과 실습 둘 다 무리 없어요.",
      "그래픽카드는 RTX 4070 SUPER 이고 부스트 클럭은 2.5GHz 입니다.",
      "CPU 는 i7-13700H 기준으로 봤어요!",
      "총액은 1,500,000원이에요.",
      "네. 가격은 테스트 가격이라 확인이 필요해요?",
      "1. 그래픽카드 메모리 확인",
      "2. 파워 정격 확인",
    ]);
  });

  it("merges short fragments forward and keeps a lone short reply", () => {
    expect(splitSentences("네. 좋아요. 그럼 이 조합으로 견적을 만들게요.")).toEqual([
      "네. 좋아요. 그럼 이 조합으로 견적을 만들게요.",
    ]);
    expect(splitSentences("네.")).toEqual(["네."]);
    expect(splitSentences("")).toEqual([]);
  });

  it("cuts long sentences at a comma or space without losing words", () => {
    const clause = "그래픽카드 메모리와 파워 정격과 케이스 길이를 함께 확인했고";
    const long = `${Array.from({ length: 8 }, () => clause).join(", ")} 결과는 모두 통과예요.`;
    const parts = splitSentences(long);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((part) => part.length <= MAX_SENTENCE_CHARS)).toBe(true);
    expect(parts.every((part) => part.length >= MIN_SENTENCE_CHARS)).toBe(true);
    expect(parts.join(" ").replace(/\s+/g, " ")).toBe(long);
  });

  it("gives the same sentences whatever way the text arrives in chunks", () => {
    const whole = splitSentences(REPLY);
    for (let cut = 1; cut < REPLY.length; cut++) {
      const splitter = createSentenceSplitter();
      const got = [
        ...splitter.push(REPLY.slice(0, cut)),
        ...splitter.push(REPLY.slice(cut)),
        ...splitter.flush(),
      ];
      expect(got, `cut at ${cut}`).toEqual(whole);
    }
    const splitter = createSentenceSplitter();
    const byChar = [...REPLY].flatMap((char) => splitter.push(char));
    expect([...byChar, ...splitter.flush()]).toEqual(whole);
  });

  it("only emits a sentence once its end is confirmed", () => {
    const splitter = createSentenceSplitter();
    expect(splitter.push("지금 조합이면 게임과 실습 둘 다 무리 없어요.")).toEqual([]);
    expect(splitter.push(" 다음")).toEqual(["지금 조합이면 게임과 실습 둘 다 무리 없어요."]);
    expect(splitter.flush()).toEqual(["다음"]);
  });
});

describe("speakable", () => {
  it("drops links, citation marks and markdown, and reads middle dots as pauses", () => {
    expect(
      speakable("**추천** 조합은 [1] https://example.com/spec 에서 확인 · 가격 `미확인`"),
    ).toBe("추천 조합은 에서 확인, 가격 미확인");
    expect(speakable("- 파워 850W")).toBe("파워 850W");
  });
});
