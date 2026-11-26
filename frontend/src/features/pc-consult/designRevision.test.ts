import { expect, it } from "vitest";
import { designRevision } from "./designRevision";

it.each([
  ["나 엄마한테 용돈 받아서 예산이 600만원이 되었어 다시 견적 짜줘", { budget: 6_000_000 }],
  ["전체 예산을 6,000,000원으로 바꿔줘", { budget: 6_000_000 }],
  ["CPU AMD에서 인텔로 바꾸고 싶어", { cpuBrand: "Intel" }],
  ["Intel에서 AMD CPU로 바꿔줘", { cpuBrand: "AMD" }],
  [
    "총예산 600만 원으로 다시 견적 짜줘. CPU는 인텔로 바꿔줘",
    { budget: 6_000_000, cpuBrand: "Intel" },
  ],
  ["600만원이면 어떤가요?", null],
  ["예산이 600만원이라면 다시 짜는 게 좋을까?", null],
  ["CPU 예산을 50만원으로 올려줘", null],
  ["예산을 50만원 더 올려서 다시 견적 짜줘", null],
  ["인텔로 바꾸지 말아줘", null],
  ["인텔로 바꾸면 얼마야?", null],
  ["CPU를 인텔로 바꾸는 방법 알려줘", null],
  ["인텔로 바꿔야 하나요?", null],
  ["GPU를 AMD로 바꿔줘", null],
])("%s", (text, expected) => expect(designRevision(String(text))).toEqual(expected));
