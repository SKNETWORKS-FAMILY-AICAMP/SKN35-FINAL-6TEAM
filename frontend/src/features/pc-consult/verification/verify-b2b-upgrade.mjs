/* global URL, process, window, innerWidth, document, console */
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const output = new URL("../../../../test-results/b2b-upgrade/", import.meta.url);
const base = process.env.PC_CONSULT_URL || "http://127.0.0.1:5174/";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const report = [];
try {
  for (const width of [1440, 1024, 360]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [],
      apiCalls = [],
      checks = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/")) apiCalls.push(request.url());
    });
    async function shot(name) {
      await page.mouse.move(0, 0);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: fileURLToPath(new URL(`${name}-${width}.png`, output)),
        fullPage: true,
      });
      const dimensions = await page.evaluate(() => ({
        viewport: innerWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      expect(dimensions.scroll, `${name} horizontal overflow`).toBeLessThanOrEqual(width);
      checks.push({ name, ...dimensions });
    }
    async function menu(label) {
      if (width === 360)
        await page.getByRole("button", { name: "☰ 기업 메뉴", exact: true }).click();
      await page
        .getByRole("navigation", { name: "기업 메뉴", exact: true })
        .getByRole("button", { name: label, exact: true })
        .click();
    }
    async function nextStage(number) {
      await page
        .getByRole("region", { name: "발표 모드", exact: true })
        .getByRole("button", { name: "다음 단계 →", exact: true })
        .click();
      await expect(page.getByText(`발표 ${number} / 7`, { exact: true })).toBeVisible();
    }
    await page.goto(`${base}?pace=300`);
    await page.getByRole("button", { name: /기업.*AI 고객센터/ }).click();
    await page.getByRole("button", { name: /관리자로 시연/ }).click();
    await expect(page.locator(".management-company-strip")).toContainText("9,917");
    await shot("home");
    await page.getByRole("button", { name: "3분 발표 모드 시작", exact: true }).click();
    await shot("presentation-01");
    await nextStage(2);
    await expect(page.locator(".b2b-catalog-totals")).toContainText("23,032");
    await shot("catalog");
    await shot("presentation-02");
    await nextStage(3);
    await expect(page.getByLabel("할인 자동 응대 한도", { exact: true })).toHaveValue("3");
    await shot("policy");
    await shot("presentation-03");
    await page.getByRole("button", { name: "같은 엔진, 다른 기업", exact: true }).click();
    await page.getByRole("button", { name: "같은 설문으로 비교", exact: true }).click();
    await expect(page.locator(".b2b-comparison > section")).toHaveCount(2);
    await expect(
      page.locator(".b2b-comparison > section").first().locator("li").first(),
    ).toBeVisible();
    const compareNames = await page
      .locator(".b2b-comparison > section li:first-child strong")
      .allTextContents();
    expect(compareNames[0]).not.toBe(compareNames[1]);
    await shot("company-comparison");
    await nextStage(4);
    await page.getByRole("button", { name: "발표용 설문 불러오기", exact: true }).click();
    await expect(page.getByRole("button", { name: "상담 시작", exact: true })).toBeVisible();
    await shot("customer-preview");
    await page.getByRole("button", { name: "상담 시작", exact: true }).click();
    await expect(page.locator(".pc-recommended")).toBeVisible({ timeout: 60000 });
    await expect(page.locator(".b2b-handoff-banner")).toContainText("5%");
    await shot("preview-candidates-before");
    await shot("presentation-04");
    await page.getByRole("button", { name: "대화와 팀 기록을 사람에게 인계", exact: true }).click();
    await nextStage(5);
    await shot("handoff");
    await shot("presentation-05");
    await page.locator(".seller-issue-card").filter({ hasText: "고객 미리보기 상담 인계" }).click();
    await expect(page.getByRole("dialog")).toContainText("5%");
    await shot("handoff-detail");
    await page.keyboard.press("Escape");
    await nextStage(6);
    await shot("feedback");
    await shot("presentation-06");
    await page.getByRole("button", { name: /정책 한도 검토/ }).click();
    await expect(page.getByLabel("할인 자동 응대 한도", { exact: true })).toBeVisible();
    await page.getByLabel("할인 자동 응대 한도", { exact: true }).fill("7");
    await page.getByRole("button", { name: "정책 저장", exact: true }).click();
    await expect(page.getByText("적용 버전 2", { exact: true })).toBeVisible();
    await nextStage(7);
    await page.getByRole("button", { name: "같은 설문으로 다시 실행", exact: true }).click();
    await page.getByRole("button", { name: "상담 시작", exact: true }).click();
    await expect(page.locator(".pc-recommended")).toBeVisible({ timeout: 60000 });
    await expect(page.locator(".b2b-handoff-banner")).toHaveCount(0);
    await expect(page.locator(".b2b-presentation-comparison")).toContainText("정책 2");
    await shot("preview-candidates-after");
    await shot("presentation-07");
    await page.getByRole("button", { name: "발표 종료", exact: true }).click();
    await menu("AI 직원 · 사람 직원");
    await shot("ai-teams");
    await menu("기업 홈");
    await expect(page.locator(".management-activity")).toContainText("RAM");
    await shot("home-after-consult");
    await page.getByRole("button", { name: "시연 제어 열기", exact: true }).click();
    await shot("demo-controls");
    await page.getByRole("button", { name: "처음으로", exact: true }).click();
    await expect(page.locator(".management-human-card")).toContainText("6");
    await page.getByRole("button", { name: "로그아웃", exact: true }).click();
    await page.getByRole("button", { name: /기업.*AI 고객센터/ }).click();
    await page.getByRole("button", { name: /상담원으로 시연/ }).click();
    await menu("상품 · 정책 · 관리자 전용");
    await expect(page.locator(".seller-toast")).toContainText("관리자");
    await expect(page.locator(".b2b-policy-form")).toHaveCount(0);
    expect(errors).toEqual([]);
    expect(apiCalls).toEqual([]);
    report.push({ width, checks, compareNames, errors, apiCalls, policyHandoffChanged: true });
    await page.close();
  }
} finally {
  await writeFile(new URL("verification-report.json", output), JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(JSON.stringify(report, null, 2));
