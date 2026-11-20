/* global document, innerWidth, innerHeight */
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import console from "node:console";

const phase = process.env.ENTRY_PHASE === "before" ? "before" : "after";
const output = new URL(`../../../../test-results/start-screen/${phase}/`, import.meta.url);
const base = process.env.PC_CONSULT_URL ?? "http://127.0.0.1:5174/";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const width of [1440, 1024, 360]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    async function capture(name) {
      await page.mouse.move(0, 0);
      await page.screenshot({
        path: fileURLToPath(new URL(`${name}-${width}.png`, output)),
        fullPage: true,
      });
      const layout = await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        contentWidth: document.documentElement.scrollWidth,
        contentHeight: document.documentElement.scrollHeight,
      }));
      expect(layout.contentWidth, `${name} ${width}: horizontal overflow`).toBeLessThanOrEqual(
        width,
      );
      results.push({ name, ...layout });
    }
    await page.goto(base);
    await expect(page.locator(".pc-entry-choices")).toBeVisible();
    await capture("welcome");
    await page.getByRole("button", { name: /기업 AI 고객센터/ }).click();
    await capture("business-login");
    if (phase === "after") {
      await page.getByRole("button", { name: "회원가입", exact: true }).click();
      await page.getByRole("textbox", { name: "아이디", exact: true }).fill("시연확인");
      await page.locator("#pc-password").fill("demo-only");
      await page.getByRole("textbox", { name: "기업 인증번호" }).fill("INVALID");
      await page.getByRole("button", { name: "회원가입", exact: true }).click();
      await expect(page.getByRole("alert")).toContainText("등록되지 않은 기업 인증번호");
      await page.getByRole("textbox", { name: "기업 인증번호" }).fill("BW-2002");
      await page.getByRole("button", { name: "회원가입", exact: true }).click();
      await expect(
        page.getByText("시연 회원가입이 완료되었습니다.", { exact: false }),
      ).toBeVisible();
      await page.getByRole("button", { name: "관리자로 시연", exact: true }).click();
      await expect(page.locator(".seller-workspace")).toBeVisible();
      await page.goto(base);
      await page.getByRole("button", { name: /개인 부품 교체와 새 PC/ }).click();
    } else {
      await page.getByRole("button", { name: "개인용", exact: true }).click();
    }
    await capture("personal-login");
    if (phase === "after") {
      await page.getByRole("button", { name: /개인용 시연으로 시작/ }).click();
      await expect(page.locator(".pc-type-screen")).toBeVisible();
      await page.goto(base);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await capture("reduced-motion");
      const animated = await page
        .locator(".bw-welcome-visual")
        .evaluate(
          (element) =>
            [...element.getAnimations({ subtree: true })].filter(
              (animation) => animation.playState === "running",
            ).length,
        );
      expect(animated, "Reduced motion disables decorative animation").toBe(0);
    }
    expect(errors, `Page errors at ${width}`).toEqual([]);
    await page.close();
  }
} finally {
  await browser.close();
  await writeFile(new URL("report.json", output), JSON.stringify(results, null, 2));
}
console.log(JSON.stringify({ phase, captures: results.length, results }, null, 2));
