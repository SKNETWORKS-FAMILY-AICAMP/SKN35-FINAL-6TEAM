import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

/**
 * 음성 엔진 실험 화면(개발 서버 전용 ?voice-lab)에서 가짜 받아쓰기·읽기·감지기로 흐름을 확인합니다.
 * 백엔드가 필요 없고, 마이크나 스피커도 쓰지 않습니다.
 */

const LONG_SENTENCES = 4;
/** useVoiceConsultation 의 ACKS 와 같은 문장들. */
const ACK_PATTERN = /^(네, 잠시만요|네, 확인할게요|네, 알겠어요|좋아요, 잠시만요)\.$/;

declare global {
  interface Window {
    __voiceLab?: {
      say: (text: string) => boolean;
      userSpeaks: () => boolean;
      speaking: () => boolean;
      setLatency: (ms: number) => void;
      setLength: (length: "short" | "long") => void;
    };
  }
}

async function open(page: Page, latencyMs: number) {
  await page.goto("/?voice-lab&fake-speech");
  await expect(page.getByRole("heading", { name: "음성 엔진 실험실" })).toBeVisible();
  await page.waitForFunction(() => window.__voiceLab !== undefined);
  await page.evaluate((ms) => window.__voiceLab?.setLatency(ms), latencyMs);
  await page.getByTestId("voice-reply").click();
  await page.getByTestId("voice-mic").click();
  await expect(page.getByTestId("voice-status")).toHaveText("듣는 중");
}

async function say(page: Page, text: string) {
  expect(await page.evaluate((value) => window.__voiceLab?.say(value) ?? false, text)).toBe(true);
}

const spoken = (page: Page) => page.getByTestId("voice-lab-spoken").locator("li");

/** 소리가 나는 동안을 페이지 안에서 기다렸다가 바로 끼어듭니다(왕복 지연으로 짧은 반응을 놓치지 않게). */
async function interruptWhileSpeaking(page: Page) {
  const interrupted = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const started = Date.now();
        const tick = () => {
          const lab = window.__voiceLab;
          if (lab?.speaking()) resolve(lab.userSpeaks());
          else if (Date.now() - started > 5000) resolve(false);
          else setTimeout(tick, 2);
        };
        tick();
      }),
  );
  expect(interrupted).toBe(true);
}

test("늦은 답에는 즉시 반응을 먼저 읽고, 답은 문장 순서대로 읽는다", async ({ page }) => {
  await open(page, 2000);
  await say(page, "그래픽카드 추천해 주세요");
  await expect(spoken(page).first()).toHaveText(ACK_PATTERN, { timeout: 3000 });
  await expect(page.getByTestId("voice-status")).toHaveText(/보내는 중/);
  await expect(spoken(page)).toHaveCount(1 + LONG_SENTENCES, { timeout: 8000 });
  await expect(spoken(page).nth(1)).toContainText("실험용 답입니다.");
  await expect(spoken(page).last()).toContainText("판매가를 확인해 주세요.");
  await expect(page.locator('[data-testid="voice-lab-spoken"] li[data-cancelled]')).toHaveCount(0);
  await expect(page.getByTestId("voice-status")).toHaveText("듣는 중", { timeout: 8000 });
  const firstAudio = page.locator('[data-interval="firstAudio"] td').first();
  await expect(firstAudio).toHaveText("1");
});

test("빠른 답에는 즉시 반응 없이 바로 답을 읽는다", async ({ page }) => {
  await open(page, 100);
  await say(page, "그래픽카드 추천해 주세요");
  await expect(spoken(page).first()).toContainText("실험용 답입니다.", { timeout: 3000 });
  await expect(spoken(page)).toHaveCount(LONG_SENTENCES, { timeout: 8000 });
});

test("답을 읽는 중에 말하면 읽기를 멈추고 다시 듣는다", async ({ page }) => {
  await open(page, 100);
  await say(page, "그래픽카드 추천해 주세요");
  await interruptWhileSpeaking(page);
  await expect(page.getByTestId("voice-status")).toHaveText("듣는 중");
  await expect(spoken(page).first()).toHaveAttribute("data-cancelled", "true");
  await page.waitForTimeout(1500);
  await expect(spoken(page)).toHaveCount(1);
  // 끊긴 답도 대화 기록에는 그대로 남습니다.
  await expect(page.locator("#conversation")).toContainText("판매가를 확인해 주세요.");
});

test("즉시 반응 중에 말하면 반응만 멈추고, 그 답은 화면에만 둔다", async ({ page }) => {
  await open(page, 2000);
  await say(page, "그래픽카드 추천해 주세요");
  await interruptWhileSpeaking(page);
  await expect(spoken(page)).toHaveCount(1);
  await expect(page.getByTestId("voice-notice")).toBeVisible();
  await expect(page.locator("#conversation")).toContainText("판매가를 확인해 주세요.", {
    timeout: 5000,
  });
  await expect(page.getByTestId("voice-status")).toHaveText("듣는 중");
  await page.waitForTimeout(500);
  await expect(spoken(page)).toHaveCount(1);
});

test("읽는 중에 글로 보내면 읽기를 멈춘다", async ({ page }) => {
  await open(page, 100);
  await say(page, "그래픽카드 추천해 주세요");
  await expect(spoken(page)).toHaveCount(1, { timeout: 3000 });
  await page.getByPlaceholder("예: 노트북 추천, 예산 300만 원").fill("파워만 바꿔 주세요");
  await page.getByTestId("chat-send").click();
  // 글로 보낸 턴의 답이 처음부터 다시 읽힐 때까지, 앞 답의 마지막 문장은 읽히지 않아야 합니다.
  await expect(spoken(page).filter({ hasText: "실험용 답입니다." })).toHaveCount(2, {
    timeout: 5000,
  });
  const texts = await spoken(page).allTextContents();
  const restart = texts.findLastIndex((text) => text.startsWith("실험용 답입니다."));
  expect(texts.slice(0, restart).some((text) => text.includes("판매가를 확인해 주세요."))).toBe(
    false,
  );
});

test("턴 시간 기록을 글 없이 JSON 으로 내보낸다", async ({ page }) => {
  await open(page, 100);
  await say(page, "그래픽카드 추천해 주세요");
  await expect(spoken(page)).toHaveCount(LONG_SENTENCES, { timeout: 8000 });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("voice-timing-export").click(),
  ]);
  const body = await readFile((await download.path()) as string, "utf-8");
  const parsed = JSON.parse(body);
  expect(parsed.format).toBe("buildwise-voice-timing/1");
  expect(parsed.turns[0]).toMatchObject({ source: "voice", endpointRule: "final" });
  expect(parsed.turns[0].marks).toHaveProperty("firstContentAudio");
  expect(body).not.toContain("그래픽카드");
  expect(body).not.toContain("실험용 답");
});

for (const width of [1440, 390]) {
  test(`${width}px 에서 가로로 넘치지 않는다`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page, 100);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
