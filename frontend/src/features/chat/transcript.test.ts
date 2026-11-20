import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../../api/client";
import { conditionTags, formatMessageTime } from "./transcript";

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 1,
    session_id: "test",
    role: "user",
    content: "노트북을 추천해 주세요. 예산 300만 원, 파인튜닝용이에요.",
    quick_replies: [],
    nlu: null,
    created_at: "2026-11-12T00:00:00Z",
    ...overrides,
  };
}

function withSlots(slots: NonNullable<ChatMessage["nlu"]>["slots"]) {
  return message({
    nlu: { intent: "new_recommendation", slots, confidence: 0.8, source: "rules" },
  });
}

describe("conditionTags", () => {
  it("NLU가 없으면 원문에 조건이 있어도 태그를 만들어 내지 않는다", () => {
    expect(conditionTags(message())).toEqual([]);
    expect(conditionTags(withSlots({}))).toEqual([]);
  });

  it("서버가 추출한 조건을 한국어 이름·단위로 표시한다", () => {
    expect(
      conditionTags(
        withSlots({
          purpose: "llm_finetune",
          budget_max: 2_500_000,
          product_types: ["laptop", "desktop", "laptop"],
          model_params_b: 7,
          precision: "int4",
          workload: "lora",
          weekly_hours: 10.5,
        }),
      ),
    ).toEqual([
      { label: "용도", value: "모델 파인튜닝" },
      { label: "예산", value: "2,500,000원" },
      { label: "상품 유형", value: "노트북 · 데스크톱" },
      { label: "모델 크기", value: "7B" },
      { label: "정밀도", value: "4비트" },
      { label: "작업 방식", value: "LoRA 학습" },
      { label: "주당 사용", value: "10.5시간" },
    ]);
  });

  it("답의 NLU나 알 수 없는 슬롯, 빈 값·유효하지 않은 수는 표시하지 않는다", () => {
    const customer = withSlots({ budget_max: 3_000_000 });
    expect(conditionTags({ ...customer, role: "assistant" })).toEqual([]);
    expect(
      conditionTags(
        withSlots({
          unknown: "없는 조건",
          purpose: "  ",
          product_types: [],
          budget_max: -1,
          model_params_b: Number.NaN,
          weekly_hours: Number.POSITIVE_INFINITY,
          owned_ram_gb: "32",
        }),
      ),
    ).toEqual([]);
  });

  it("명시된 내장 그래픽의 VRAM 0GB를 없다고 숨기지 않는다", () => {
    expect(conditionTags(withSlots({ owned_device: "laptop", owned_vram_gb: 0 }))).toEqual([
      { label: "보유 장비", value: "노트북" },
      { label: "보유 VRAM", value: "0GB" },
    ]);
  });
});

describe("formatMessageTime", () => {
  it("UTC와 시간대 없는 서버 시각을 동일한 한국 시각으로 표시한다", () => {
    expect(formatMessageTime("2026-11-12T00:03:04Z")).toBe("09:03:04");
    expect(formatMessageTime("2026-11-12T00:03:04.123456")).toBe("09:03:04");
    expect(formatMessageTime("2026-11-12T09:03:04+09:00")).toBe("09:03:04");
    expect(formatMessageTime("2026-11-12T15:00:00Z")).toBe("00:00:00");
  });

  it("시각이 없거나 잘못되면 현재 시각으로 대신하지 않는다", () => {
    expect(formatMessageTime("")).toBe("시각 미확인");
    expect(formatMessageTime("잘못된 시각")).toBe("시각 미확인");
    expect(formatMessageTime("2026-13-12T00:00:00Z")).toBe("시각 미확인");
  });
});
