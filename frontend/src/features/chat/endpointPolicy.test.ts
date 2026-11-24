import { describe, expect, it } from "vitest";
import {
  CONTINUATION_DELAY_MS,
  DEFAULT_DELAY_MS,
  FINAL_DELAY_MS,
  endpointDelay,
  fixedEndpoint,
} from "./endpointPolicy";

describe("endpointDelay", () => {
  it.each([
    ["그래픽카드 추천해 주세요", "final"],
    ["노트북이 필요해요", "final"],
    ["이 조합이면 충분합니다", "final"],
    ["예산 안에서 맞춰 줘", "final"],
    ["그럼 그걸로 할게", "final"],
    ["이 조합으로 해", "final"],
    ["이 정도면 될까", "final"],
    ["파워가 부족하지 않을까요?", "final"],
    ["그럼 화이트 케이스로 하자", "final"],
  ])("ends quickly after a finished sentence: %s", (text, rule) => {
    expect(endpointDelay(text)).toEqual({ delayMs: FINAL_DELAY_MS, rule });
  });

  it.each([
    ["예산은 백오십만 원인데 그래픽카드는", "continuation"],
    ["제가요 노트북을", "continuation"],
    ["게임도 하고 영상 편집도 하고", "continuation"],
    ["작업용으로 쓰려면 아무래도 그러니까", "filler"],
    ["그래픽카드는 음", "filler"],
    ["게임할 때 렉이 걸려서", "continuation"],
  ])("waits longer when more is coming: %s", (text, rule) => {
    expect(endpointDelay(text)).toEqual({ delayMs: CONTINUATION_DELAY_MS, rule });
  });

  it.each([
    ["견적서 한 장 보여 주실 견적서", "default"],
    ["이 그래픽카드 재고 없어", "default"],
    ["다음 달이 미래", "default"],
    ["16기가는 꼭 필요", "default"],
    ["좋아요", "short"],
    ["그걸로 할게", "short"],
    ["보고서 순서", "short"],
    ["네", "short"],
  ])("uses the middle value when unsure: %s", (text, rule) => {
    expect(endpointDelay(text)).toEqual({ delayMs: DEFAULT_DELAY_MS, rule });
  });

  it("looks at the last word only and ignores trailing punctuation", () => {
    expect(endpointDelay("제가요, 노트북을요 바꾸고 싶어요...").rule).toBe("final");
    expect(endpointDelay("그래픽카드 추천해 주세요~ ").rule).toBe("final");
    expect(endpointDelay("   ").rule).toBe("short");
  });

  it("can be replaced by a fixed delay", () => {
    expect(fixedEndpoint(1000)("아무 말")).toEqual({ delayMs: 1000, rule: "default" });
  });
});
