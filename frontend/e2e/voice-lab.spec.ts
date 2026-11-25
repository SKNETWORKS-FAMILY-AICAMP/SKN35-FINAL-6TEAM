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
      readings: () => { server: number; browser: number; fallback: number; fetchMs: number[] }[];
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

// --- 서버 음성 경로(?tts=server). 서버는 page.route 로 흉내 내고, 재생은 실제 오디오로 합니다. ---

const SPEECH_ROUTE = "**/api/pc-consult/sessions/voice-lab/speech";
const ACK_TEXTS = new Set([
  "네, 잠시만요.",
  "네, 확인할게요.",
  "네, 알겠어요.",
  "좋아요, 잠시만요.",
]);

/** 24kHz 모노 16비트 사인파 WAV. */
function sineWav(seconds: number): Buffer {
  const rate = 24_000;
  const frames = Math.round(rate * seconds);
  const data = Buffer.alloc(frames * 2);
  for (let index = 0; index < frames; index++) {
    data.writeInt16LE(Math.round(Math.sin((index / rate) * 2 * Math.PI * 440) * 3000), index * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

interface SpeechServer {
  requests: { text: string; at: number }[];
  content: () => { text: string; at: number }[];
}

async function fakeSpeechServer(
  page: Page,
  options: { status?: number; delayMs?: number; seconds?: number; acksOk?: boolean } = {},
): Promise<SpeechServer> {
  const requests: { text: string; at: number }[] = [];
  await page.route(SPEECH_ROUTE, async (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      await route.fulfill({ json: { enabled: true, dictionary: [] } });
      return;
    }
    const text = (request.postDataJSON() as { text: string }).text;
    requests.push({ text, at: Date.now() });
    await new Promise((resolve) => setTimeout(resolve, options.delayMs ?? 150));
    const failing = options.status && options.status !== 200;
    if (failing && !(options.acksOk && ACK_TEXTS.has(text))) {
      await route.fulfill({ status: options.status, body: "실패" }).catch(() => undefined);
      return;
    }
    await route
      .fulfill({ status: 200, contentType: "audio/wav", body: sineWav(options.seconds ?? 0.3) })
      .catch(() => undefined);
  });
  return { requests, content: () => requests.filter((item) => !ACK_TEXTS.has(item.text)) };
}

async function openServerVoice(page: Page, latencyMs: number, mic = true) {
  await page.goto("/?voice-lab&fake-speech&tts=server");
  await expect(page.getByRole("heading", { name: "음성 엔진 실험실" })).toBeVisible();
  await page.waitForFunction(() => window.__voiceLab !== undefined);
  await page.evaluate((ms) => window.__voiceLab?.setLatency(ms), latencyMs);
  await page.getByTestId("voice-reply").click();
  if (mic) {
    await page.getByTestId("voice-mic").click();
    await expect(page.getByTestId("voice-status")).toHaveText("듣는 중");
  }
}

const readings = (page: Page) =>
  page.evaluate(() => {
    const all = window.__voiceLab?.readings() ?? [];
    return all.reduce(
      (sum, item) => ({
        server: sum.server + item.server,
        browser: sum.browser + item.browser,
        fallback: sum.fallback + item.fallback,
      }),
      { server: 0, browser: 0, fallback: 0 },
    );
  });

test("서버 음성으로 문장 순서대로 읽고, 다음 문장은 미리 받는다", async ({ page }) => {
  const server = await fakeSpeechServer(page, { delayMs: 200 });
  await openServerVoice(page, 100);
  await say(page, "그래픽카드 추천해 주세요");
  await expect
    .poll(() => readings(page), { timeout: 10_000 })
    .toMatchObject({
      server: LONG_SENTENCES,
      browser: 0,
    });
  const content = server.content();
  expect(content.map((item) => item.text)).toHaveLength(LONG_SENTENCES);
  expect(content[0].text).toContain("실험용 답입니다.");
  expect(content.at(-1)?.text).toContain("판매가를 확인해 주세요.");
  // 답이 오자마자 첫 두 문장을 같이 요청합니다.
  expect(content[1].at - content[0].at).toBeLessThan(150);
  await expect(spoken(page)).toHaveCount(0);
  await expect(page.getByTestId("voice-status")).toHaveText("듣는 중", { timeout: 8000 });
});

test("서버 음성이 실패하면 그 문장은 브라우저 읽기로 넘어간다", async ({ page }) => {
  // 즉시 반응은 성공하고 답 문장만 실패하게 해서, 닫힌 회로에서 실제로 넘어가는 경로를 봅니다.
  await fakeSpeechServer(page, { status: 503, acksOk: true });
  await openServerVoice(page, 100);
  await say(page, "그래픽카드 추천해 주세요");
  await expect(spoken(page)).toHaveCount(LONG_SENTENCES, { timeout: 10_000 });
  await expect(spoken(page).first()).toContainText("실험용 답입니다.");
  const counts = await readings(page);
  expect(counts.server).toBe(0);
  expect(counts.fallback).toBeGreaterThan(0);
  expect(counts.browser).toBe(LONG_SENTENCES);
});

test("서버 실패로 브라우저가 읽는 중에 그만 읽기를 누르면 멈춘다", async ({ page }) => {
  await fakeSpeechServer(page, { status: 503, acksOk: true });
  await openServerVoice(page, 100);
  await say(page, "그래픽카드 추천해 주세요");
  // 브라우저(가짜) 읽기가 소리를 내는 동안 페이지 안에서 바로 누릅니다(왕복 지연으로 문장이 바뀌지 않게).
  const countAtStop = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const started = Date.now();
        const tick = () => {
          const button = document.querySelector<HTMLButtonElement>('[data-testid="voice-stop"]');
          if (window.__voiceLab?.speaking() && button) {
            button.click();
            resolve(document.querySelectorAll('[data-testid="voice-lab-spoken"] li').length);
          } else if (Date.now() - started > 8000) resolve(-1);
          else setTimeout(tick, 2);
        };
        tick();
      }),
  );
  expect(countAtStop).toBeGreaterThan(0);
  await expect(page.getByTestId("voice-status")).toHaveText("듣는 중");
  await expect(page.locator('[data-testid="voice-lab-spoken"] li[data-cancelled]')).toHaveCount(1);
  await page.waitForTimeout(1500);
  await expect(spoken(page)).toHaveCount(countAtStop);
});

test("서버 음성을 읽는 중에 그만 읽기를 누르면 더 재생하지 않는다", async ({ page }) => {
  await fakeSpeechServer(page, { delayMs: 100, seconds: 2 });
  await openServerVoice(page, 100);
  await say(page, "그래픽카드 추천해 주세요");
  // 서버 음성이 재생되기 시작하면 페이지 안에서 바로 누르고, 그때까지 읽은 문장 수를 기록합니다.
  const serverAtStop = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const started = Date.now();
        const tick = () => {
          const server = (window.__voiceLab?.readings() ?? []).reduce(
            (sum, item) => sum + item.server,
            0,
          );
          const button = document.querySelector<HTMLButtonElement>('[data-testid="voice-stop"]');
          if (server >= 1 && button) {
            button.click();
            resolve(server);
          } else if (Date.now() - started > 8000) resolve(-1);
          else setTimeout(tick, 2);
        };
        tick();
      }),
  );
  expect(serverAtStop).toBeGreaterThan(0);
  await expect(page.getByTestId("voice-status")).toHaveText("듣는 중");
  await page.waitForTimeout(2500);
  expect(await readings(page)).toMatchObject({ server: serverAtStop, browser: 0 });
});

test("마이크 없이 글만 보내도 서버 음성으로 읽는다", async ({ page }) => {
  await fakeSpeechServer(page);
  await openServerVoice(page, 100, false);
  await page.getByPlaceholder("예: 노트북 추천, 예산 300만 원").fill("그래픽카드 추천해 주세요");
  await page.getByTestId("chat-send").click();
  await expect
    .poll(async () => (await readings(page)).server, { timeout: 10_000 })
    .toBe(LONG_SENTENCES);
  await expect(spoken(page)).toHaveCount(0);
});
