/* global window, document, innerWidth */
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import console from "node:console";

// Uses the repository browser and supplied snapshot data. Screenshots remain outside src/public.
const output = new URL("../../../../test-results/ui-redesign/customer/", import.meta.url);
const base = process.env.PC_CONSULT_URL ?? "http://127.0.0.1:5174/";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const report = [];
try {
  for (const width of [1440, 1024, 360]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [],
      apiRequests = [],
      captures = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests.push(request.url());
    });
    async function shot(name) {
      await page.mouse.move(0, 0);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: fileURLToPath(new URL(`${name}-${width}.png`, output)),
        fullPage: true,
      });
      if (["type", "candidates"].includes(name)) {
        await page.screenshot({
          path: fileURLToPath(new URL(`${name}-viewport-${width}.png`, output)),
        });
      }
      const dimensions = await page.evaluate(() => ({
        viewport: innerWidth,
        document: document.documentElement.scrollWidth,
      }));
      expect(dimensions.document, `${name} overflow`).toBeLessThanOrEqual(width);
      captures.push({ name, ...dimensions });
    }
    await page.goto(`${base}?pace=300`);
    await shot("entry");
    await page.getByRole("button", { name: /개인 부품 교체와 새 PC/ }).click();
    await shot("login");
    await page.getByRole("button", { name: /개인용 시연으로 시작/ }).click();
    await expect(page.locator("#conversation .pc-type-screen")).toBeVisible();
    await expect(page.locator(".pc-type-card .pc-hardware-art")).toHaveCount(2);
    if (width >= 1024) {
      const chat = await page.locator("#conversation").boundingBox();
      const office = await page.locator(".office-board").boundingBox();
      expect(chat.width).toBeGreaterThan(office.width);
      expect(chat.x).toBeLessThan(office.x);
    }
    await shot("type");
    await page.getByTestId("chat-input").fill("선택한 조건과 대화가 유지되는지 확인해 주세요.");
    await page.getByTestId("chat-send").click();
    await page.getByRole("button", { name: /신규 PC 조립/ }).click();
    await page.getByLabel("얼마까지 생각하고 계세요?", { exact: true }).fill("3000000");
    await page.getByRole("checkbox", { name: /고사양 게임/ }).check();
    await page.getByLabel("목표 해상도").selectOption("qhd");
    await shot("survey");
    await page.getByRole("button", { name: /입력 내용 확인/ }).click();
    await expect(page.locator("#conversation .pc-review")).toContainText("₩3,000,000");
    await shot("review");
    await page.getByRole("button", { name: "상담 시작", exact: true }).click();
    await expect(page.locator(".pc-recommended")).toBeVisible({ timeout: 60000 });
    await expect(page.locator("#results .pc-selection")).toBeVisible();
    await expect(page.locator(".pc-recommended .pc-hardware-art")).toBeVisible();
    await expect(page.locator(".consultation-build-summary")).toContainText("₩3,000,000");
    await expect(
      page.getByTestId("chat-user").filter({ hasText: "선택한 조건과 대화가 유지" }),
    ).toHaveCount(1);
    if (width >= 1024) {
      const results = await page.locator("#results").boundingBox();
      const office = await page.locator(".office-board").boundingBox();
      expect(results.width).toBeGreaterThan(office.width);
      expect(results.x).toBeLessThan(office.x);
    }
    await shot("candidates");
    await page.locator(".office-room-validation").click();
    await expect(page.getByTestId("office-work-detail")).toBeVisible();
    await expect(page.getByTestId("office-work-detail")).toContainText("받은 검증 기록");
    await shot("office-detail");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("office-work-detail")).toHaveCount(0);
    await expect(page.locator(".office-room-validation")).toBeFocused();
    await page.getByRole("button", { name: /이 부품에 예산 더 쓰기/ }).click();
    await expect(page.locator(".pc-budget-screen")).toBeVisible();
    await shot("budget");
    expect(errors).toEqual([]);
    expect(apiRequests).toEqual([]);
    report.push({
      width,
      captures,
      errors,
      apiRequests,
      decisionAreaWiderThanOffice: width >= 1024,
      conversationPreserved: true,
    });
    await page.close();
  }
} finally {
  await writeFile(new URL("report.json", output), JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify(report, null, 2));
