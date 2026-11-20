/* global window, document, innerWidth, innerHeight */
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import console from "node:console";

// Independent checks for the equal consultation/office layout; previous UI expectations stay intact.
const output = new URL("../../../../test-results/split-office/customer/", import.meta.url);
const base = process.env.PC_CONSULT_URL ?? "http://127.0.0.1:5174/";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const report = [];
const failures = [];
try {
  for (const [width, height] of [
    [1440, 900],
    [1024, 900],
    [1366, 768],
    [360, 900],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const result = { width, height, captures: [], errors: [], apiRequests: [], checks: [] };
    report.push(result);
    page.on("pageerror", (error) => result.errors.push(error.message));
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/"))
        result.apiRequests.push(request.url());
    });
    function check(name, passed, details) {
      result.checks.push({ name, passed, ...details });
      if (!passed) failures.push(`${width}x${height}: ${name} ${JSON.stringify(details)}`);
    }
    async function shot(name) {
      await page.mouse.move(0, 0);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: fileURLToPath(new URL(`${name}-${width}x${height}.png`, output)),
        fullPage: true,
      });
      await page.screenshot({
        path: fileURLToPath(new URL(`${name}-viewport-${width}x${height}.png`, output)),
      });
      const dimensions = await page.evaluate(() => ({
        viewport: innerWidth,
        viewportHeight: innerHeight,
        document: document.documentElement.scrollWidth,
        documentHeight: document.documentElement.scrollHeight,
      }));
      result.captures.push({ name, ...dimensions });
      check(`${name}: 가로 넘침 없음`, dimensions.document <= width, dimensions);
      return dimensions;
    }
    async function equalColumns(name, leftSelector) {
      const left = await page.locator(leftSelector).boundingBox();
      const office = await page.locator(".office-board").boundingBox();
      check(
        `${name}: 50:50 열 너비`,
        Boolean(left && office && Math.abs(left.width - office.width) <= 2),
        { left, office },
      );
      check(`${name}: 상담 왼쪽, 오피스 오른쪽`, Boolean(left && office && left.x < office.x), {
        left,
        office,
      });
    }
    try {
      await page.goto(`${base}?pace=300`);
      await page.getByRole("button", { name: /개인 부품 교체와 새 PC/ }).click();
      await page.getByRole("button", { name: /개인용 시연으로 시작/ }).click();
      await expect(page.locator("#conversation .pc-type-screen")).toBeVisible();
      await expect(page.locator(".pc-type-card")).toHaveCount(2);
      const entry = await shot("type");
      const cards = await page.locator(".pc-type-card").evaluateAll((elements) =>
        elements.map((element) => {
          const bounds = element.getBoundingClientRect();
          return {
            name: element.querySelector("strong")?.textContent,
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            bottom: bounds.bottom,
            right: bounds.right,
          };
        }),
      );
      check(
        "두 상담 카드가 첫 화면 안에 표시",
        cards.every(
          (card) => card.x >= 0 && card.y >= 0 && card.right <= width && card.bottom <= height,
        ),
        { cards },
      );
      if (width >= 1024) {
        await equalColumns("첫 진입", "#conversation");
        check("첫 진입 세로 스크롤 없음", entry.documentHeight <= height, {
          documentHeight: entry.documentHeight,
          viewportHeight: height,
        });
      }
      console.log(
        JSON.stringify({
          stage: "entry",
          width,
          height,
          documentHeight: entry.documentHeight,
          cards,
        }),
      );
      const history = page.locator("details.transcript-history");
      await expect(history).toHaveJSProperty("open", false);
      await history.locator("summary").click();
      await expect(history).toHaveJSProperty("open", true);
      await expect(history.locator(".transcript-log")).toBeVisible();
      await shot("type-history-open");
      await history.locator("summary").click();
      await expect(history).toHaveJSProperty("open", false);
      const sent = "상담 단계가 바뀌어도 이 대화를 유지해 주세요.";
      await page.getByTestId("chat-input").fill(sent);
      await page.getByTestId("chat-send").click();
      await history.locator("summary").click();
      await expect(page.getByTestId("chat-user").filter({ hasText: sent })).toBeVisible();
      await history.locator("summary").click();
      check("첫 화면 대화 기록 펼침·접기와 입력 전송", true, {});
      await page.getByRole("button", { name: /신규 PC 조립/ }).click();
      await page.getByLabel("얼마까지 생각하고 계세요?", { exact: true }).fill("3000000");
      await page.getByRole("checkbox", { name: /고사양 게임/ }).check();
      await page.getByLabel("목표 해상도").selectOption("qhd");
      await shot("survey");
      await page.getByRole("button", { name: /입력 내용 확인/ }).click();
      await expect(page.locator("#conversation .pc-review")).toContainText("₩3,000,000");
      await page.getByRole("button", { name: "상담 시작", exact: true }).click();
      await expect(page.locator(".pc-recommended")).toBeVisible({ timeout: 60000 });
      await expect(page.getByTestId("chat-user").filter({ hasText: sent })).toHaveCount(1);
      await shot("candidates");
      if (width >= 1024) await equalColumns("후보 선택", "#results");
      await page.locator(".office-room-validation").click();
      await expect(page.getByTestId("office-work-detail")).toBeVisible();
      await expect(page.getByTestId("office-work-detail")).toContainText("받은 검증 기록");
      await shot("office-detail");
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("office-work-detail")).toHaveCount(0);
      await expect(page.locator(".office-room-validation")).toBeFocused();
      await page.getByRole("button", { name: /이 부품에 예산 더 쓰기/ }).click();
      await expect(page.locator(".pc-budget-screen")).toBeVisible();
      await expect(page.getByTestId("chat-user").filter({ hasText: sent })).toHaveCount(1);
      await shot("budget");
      check("후보·업무 상세·예산 단계 뒤 대화 유지", true, {});
      check("페이지 오류 없음", result.errors.length === 0, { errors: result.errors });
      check("백엔드 호출 없음", result.apiRequests.length === 0, {
        apiRequests: result.apiRequests,
      });
    } catch (error) {
      failures.push(`${width}x${height}: ${error.message}`);
      result.flowError = error.message;
      await page.screenshot({
        path: fileURLToPath(new URL(`failure-${width}x${height}.png`, output)),
        fullPage: true,
      });
    } finally {
      await page.close();
    }
  }
} finally {
  await writeFile(new URL("report.json", output), JSON.stringify({ report, failures }, null, 2));
  await browser.close();
}
console.log(
  JSON.stringify(
    {
      viewports: report.map(({ width, height, checks, flowError }) => ({
        width,
        height,
        passed: checks.filter((check) => check.passed).length,
        checks: checks.length,
        flowError,
      })),
      failures,
    },
    null,
    2,
  ),
);
expect(failures, "Equal office split and first-screen layout verification").toEqual([]);
