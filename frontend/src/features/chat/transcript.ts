import type { ChatMessage } from "../../api/client";

export interface ConditionTag {
  label: string;
  value: string;
}

const PRODUCT_LABELS: Record<string, string> = {
  laptop: "노트북",
  desktop: "데스크톱",
  gpu: "GPU",
  server: "서버",
  monitor: "모니터",
};

const PURPOSE_LABELS: Record<string, string> = {
  llm_finetune: "모델 파인튜닝",
  llm_inference: "모델 추론",
  image_generation: "이미지 생성",
  dl_study: "AI 학습·공부",
  general_dev: "일반 개발",
};

const PRECISION_LABELS: Record<string, string> = {
  fp32: "FP32",
  fp16: "FP16",
  int8: "8비트",
  int4: "4비트",
};

const WORKLOAD_LABELS: Record<string, string> = {
  inference: "추론",
  lora: "LoRA 학습",
};

type SlotValue = number | string | string[];

function translated(value: SlotValue, labels: Record<string, string>): string | null {
  const values = Array.isArray(value) ? value : [value];
  const formatted = values.flatMap((item) => {
    if (typeof item !== "string" || item.trim() === "") return [];
    return [labels[item] ?? item.trim()];
  });
  return formatted.length > 0 ? [...new Set(formatted)].join(" · ") : null;
}

function amount(value: SlotValue, unit: string, allowZero = false): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (allowZero ? value < 0 : value <= 0) return null;
  return `${value.toLocaleString("ko-KR", { maximumFractionDigits: 3 })}${unit}`;
}

/** 서버의 고객 메시지 NLU만 표시합니다. 원문에서 조건을 추측하지 않습니다. */
export function conditionTags(message: ChatMessage): ConditionTag[] {
  if (message.role !== "user" || !message.nlu) return [];
  const slots = message.nlu.slots;
  const fields: [string, string, (value: SlotValue) => string | null][] = [
    ["purpose", "용도", (value) => translated(value, PURPOSE_LABELS)],
    ["budget_max", "예산", (value) => amount(value, "원")],
    ["product_types", "상품 유형", (value) => translated(value, PRODUCT_LABELS)],
    ["model_params_b", "모델 크기", (value) => amount(value, "B")],
    ["precision", "정밀도", (value) => translated(value, PRECISION_LABELS)],
    ["workload", "작업 방식", (value) => translated(value, WORKLOAD_LABELS)],
    ["owned_device", "보유 장비", (value) => translated(value, PRODUCT_LABELS)],
    ["owned_ram_gb", "보유 RAM", (value) => amount(value, "GB", true)],
    ["owned_vram_gb", "보유 VRAM", (value) => amount(value, "GB", true)],
    ["weekly_hours", "주당 사용", (value) => amount(value, "시간")],
  ];

  return fields.flatMap(([key, label, format]) => {
    const slot = slots[key];
    if (slot === undefined) return [];
    const value = format(slot);
    return value === null ? [] : [{ label, value }];
  });
}

const messageClock = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** DB의 시간대 없는 시각도 UTC라는 기존 계약에 맞춰 한국 시각으로 표시합니다. */
export function formatMessageTime(iso: string): string {
  const value = iso.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return "시각 미확인";
  const timestamp = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`;
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? "시각 미확인" : messageClock.format(parsed);
}
