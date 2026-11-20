/* global document, innerWidth, innerHeight */
import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import console from "node:console";

// Real repository snapshots only: no response interception, invented parts, or injected state.
// Each viewport uses a fresh browser context; logout retains this tab's in-memory feedback.
const output = new URL("../../../../test-results/review-candidates/", import.meta.url);
const snapshotFile = new URL("../../../../public/demo-data/parts.snapshot.json", import.meta.url);
const snapshot = JSON.parse(await readFile(snapshotFile, "utf8"));
const knownParts = new Map(snapshot.parts.map((part) => [part.source_key, part]));
const base = process.env.PC_CONSULT_URL ?? "http://127.0.0.1:5174/";
const sizes = [
  [1440, 900],
  [360, 900],
];
const steps = [
  ["cpu", "CPU"],
  ["motherboard", "메인보드"],
  ["ram", "RAM"],
  ["gpu", "GPU"],
  ["storage", "저장장치"],
  ["cooler", "쿨러"],
  ["psu", "파워서플라이"],
  ["case", "케이스"],
];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const report = [];
const failures = [];

try {
  for (const [width, height] of sizes) {
    const context = await browser.newContext({
      viewport: { width, height },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(25000);
    const result = {
      width,
      height,
      checks: [],
      captures: [],
      steps: [],
      errors: [],
      apiRequests: [],
    };
    report.push(result);
    page.on("pageerror", (error) => result.errors.push(error.message));
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/"))
        result.apiRequests.push(request.url());
    });
    function check(name, passed, details = {}) {
      result.checks.push({ name, passed, ...details });
      if (!passed) failures.push(`${width}x${height}: ${name} ${JSON.stringify(details)}`);
    }
    async function capture(name, fullPage = false) {
      await page.mouse.move(0, 0);
      await page.screenshot({
        path: fileURLToPath(new URL(`${name}-${width}x${height}.png`, output)),
        fullPage,
      });
      const geometry = await page.evaluate(() => ({
        viewportWidth: innerWidth,
        viewportHeight: innerHeight,
        contentWidth: document.documentElement.scrollWidth,
      }));
      check(`${name}: 가로 넘침 없음`, geometry.contentWidth <= width, geometry);
      result.captures.push(name);
    }
    async function menu(name) {
      const toggle = page.getByRole("button", { name: "☰ 기업 메뉴", exact: true });
      if ((await toggle.isVisible()) && (await toggle.getAttribute("aria-expanded")) === "false")
        await toggle.click();
      await page
        .getByRole("navigation", { name: "기업 메뉴", exact: true })
        .getByRole("button", { name, exact: true })
        .click();
    }
    async function logout() {
      await page
        .locator(".shell-account")
        .getByRole("button", { name: "로그아웃", exact: true })
        .click();
      await expect(page.getByRole("form", { name: "기업용 로그인", exact: true })).toBeVisible();
    }
    async function business() {
      await page.getByRole("button", { name: "기업용", exact: true }).click();
      await page.getByRole("combobox", { name: "시연 기업", exact: true }).selectOption("BW-1001");
      await page.getByRole("button", { name: "관리자로 시연", exact: true }).click();
      await expect(page.locator(".management-home")).toBeVisible();
    }
    async function feedbackCount() {
      await menu("고객 피드백");
      await expect(page.getByTestId("review-selection-feedback")).toBeVisible();
      const label = await page.getByTestId("review-selection-count").innerText();
      const count = Number(label.replace(/[^\d]/g, ""));
      expect(Number.isFinite(count), `실제 선택 건수: ${label}`).toBe(true);
      return count;
    }
    async function cardData(card) {
      return {
        sourceKey: await card.getAttribute("data-source-key"),
        name: (await card.locator("h3").innerText()).trim(),
        price: Number(
          (await card.locator(".pc-candidate-price strong").innerText()).replace(/[^\d]/g, ""),
        ),
        unknownReasons: await card.locator(".pc-validation-list li").evaluateAll((items) =>
          items
            .filter((item) => item.querySelector(".pc-status-unknown"))
            .map(
              (item) => item.querySelector(":scope > span:last-child")?.textContent?.trim() ?? "",
            )
            .filter(Boolean),
        ),
      };
    }
    async function verifyVisiblePrices(cards, category, label) {
      const candidates = [];
      for (let index = 0; index < (await cards.count()); index++)
        candidates.push(await cardData(cards.nth(index)));
      check(
        `${label}: 스냅샷의 부품과 가격`,
        candidates.every((candidate) => {
          const part = knownParts.get(candidate.sourceKey);
          return (
            part?.category === category &&
            part.name === candidate.name &&
            part.current_price === candidate.price
          );
        }),
        { candidates: candidates.map(({ sourceKey, price }) => ({ sourceKey, price })) },
      );
      check(
        `${label}: 가격 낮은 순`,
        candidates.every(
          (candidate, index) => index === 0 || candidates[index - 1].price <= candidate.price,
        ),
      );
      return candidates;
    }
    try {
      // Start with the default company policy; unknown compatibility still requires a human.
      await page.goto(`${base}?pace=300`);
      await expect(page.getByRole("form", { name: "기업용 로그인", exact: true })).toBeVisible();
      await business();
      const baselineCount = await feedbackCount();
      result.baselineCount = baselineCount;
      await expect(page.getByTestId("review-selection-feedback")).toContainText("실제 시연 집계");
      await capture("feedback-before");
      await logout();
      await page.getByRole("button", { name: "개인용", exact: true }).click();
      await page.getByRole("button", { name: /개인용 시연으로 시작/ }).click();
      await expect(page.locator(".pc-type-screen")).toBeVisible();
      await page.getByRole("button", { name: /신규 PC 조립/ }).click();
      await expect(page.locator(".pc-consult-window")).toHaveJSProperty("open", true);
      await page.locator("#pc-budget").fill("5000000");
      await page.getByRole("checkbox", { name: /고사양 게임/ }).check();
      await page.getByRole("button", { name: /입력 내용 확인/ }).click();
      await page.getByRole("button", { name: "상담 시작", exact: true }).click();
      const selected = [];
      for (const [category, label] of steps) {
        const selection = page.locator(".pc-selection");
        await expect(
          page.getByRole("heading", { name: `${label} 후보를 골라 주세요.`, exact: true }),
        ).toBeVisible({ timeout: 60000 });
        await expect(selection).toHaveAttribute("aria-busy", "false", { timeout: 60000 });
        const passedCards = selection.locator(".pc-candidate-list > article");
        const review = page.getByTestId("pc-unknown");
        const reviewCards = review.getByTestId("pc-candidate");
        const passedCount = await passedCards.count();
        const reviewCount = await reviewCards.count();
        const reviewOnly = passedCount === 0 && reviewCount > 0;
        const step = { category, label, passedCount, reviewCount, reviewOnly };
        result.steps.push(step);
        expect(passedCount + reviewCount, `${label}: 선택 가능한 실제 스냅샷 후보`).toBeGreaterThan(
          0,
        );
        if (reviewOnly) {
          await expect(selection.locator(".pc-empty")).toHaveCount(0);
          await expect(review).toHaveJSProperty("open", true);
          await expect(review.locator("summary")).toContainText(
            "이 단계는 데이터로 확인할 수 없는 항목이 있어요",
          );
          await expect(reviewCards.first()).toBeVisible();
          await expect(page.getByTestId("pc-review-reasons")).toBeVisible();
          check(`${label}: 통과 없음은 빈 화면 대신 실제 후보와 확인 사유 표시`, true);
        }
        if (passedCount > 0) {
          await expect(passedCards.locator(".pc-recommendation")).toHaveCount(1);
          await expect(passedCards.first().locator(".pc-recommendation")).toBeVisible();
          check(`${label}: 첫 통과 후보에만 AI 추천`, true);
        }
        const chooseReview =
          reviewCount > 0 && (reviewOnly || ["storage", "cooler", "case"].includes(category));
        if (chooseReview) {
          if (!(await review.evaluate((element) => element.open)))
            await review.locator("summary").click();
          await expect(reviewCards.first()).toBeVisible();
          await expect(review.locator(".pc-recommendation")).toHaveCount(0);
          await expect(
            selection.getByText("확인 필요 후보: 가격 낮은 순 · AI 추천 없음", { exact: true }),
          ).toBeVisible();
          await verifyVisiblePrices(reviewCards, category, `${label} 확인 필요 후보`);
          const candidate = await cardData(reviewCards.first());
          expect(candidate.unknownReasons.length, `${label} 실제 확인 불가 사유`).toBeGreaterThan(
            0,
          );
          if (reviewOnly) {
            const reasons = await page.getByTestId("pc-review-reasons").innerText();
            check(
              `${label}: 상단 사유가 후보 검증 결과에 근거함`,
              candidate.unknownReasons.some((reason) => reasons.includes(reason)),
              { reasons },
            );
          }
          await review.locator("summary").scrollIntoViewIfNeeded();
          await capture(`${category}-review-reasons`);
          await reviewCards.first().scrollIntoViewIfNeeded();
          await capture(`${category}-review-candidate`);
          if (category === "storage") {
            const more = review.getByRole("button", {
              name: "확인 필요 후보 더 보기",
              exact: true,
            });
            if (await more.isVisible()) {
              const before = await reviewCards.count();
              await more.click();
              check("저장장치: 더 보기로 실제 후보 추가", (await reviewCards.count()) > before);
              await verifyVisiblePrices(reviewCards, category, "저장장치 더 보기");
            }
          }
          await reviewCards.first().getByRole("button").click();
          const warning = page.getByRole("dialog", {
            name: "확인하지 못한 항목이 있습니다",
            exact: true,
          });
          await expect(warning).toBeVisible();
          await expect(warning).toContainText(candidate.name);
          for (const reason of candidate.unknownReasons)
            await expect(warning).toContainText(reason);
          await capture(`${category}-warning`);
          // Cancel once to ensure acknowledging the warning is the only path to selection.
          if (category === "storage") {
            await warning.getByRole("button", { name: "다른 후보 보기", exact: true }).click();
            await expect(
              page.getByRole("heading", { name: `${label} 후보를 골라 주세요.`, exact: true }),
            ).toBeVisible();
            check("확인 경고를 취소하면 같은 부품 단계 유지", true);
            await reviewCards.first().getByRole("button").click();
          }
          await page.getByRole("button", { name: "주의사항을 확인하고 선택", exact: true }).click();
          selected.push({ ...candidate, category, label, review: true });
        } else {
          await verifyVisiblePrices(passedCards, category, `${label} 통과 후보`);
          const candidate = await cardData(passedCards.first());
          selected.push({ ...candidate, category, label, review: false });
          await passedCards.first().getByRole("button").click();
        }
      }
      result.selected = selected;
      const reviewed = selected.filter((item) => item.review);
      const rows = page.locator(".pc-quote-table tbody tr");
      await expect(rows).toHaveCount(8, { timeout: 60000 });
      check(
        "신규 조립은 8개 분류를 순서대로 진행",
        selected.map((item) => item.category).join() === steps.map(([category]) => category).join(),
      );
      for (const item of selected) {
        const row = rows.filter({ hasText: item.name });
        await expect(row).toHaveCount(1);
        if (!item.review) continue;
        const reviewDetails = row.getByTestId("pc-quote-item-review");
        await expect(reviewDetails).toBeVisible();
        await expect(reviewDetails).toContainText("확인 필요");
        for (const reason of item.unknownReasons) await expect(reviewDetails).toContainText(reason);
        check(`${item.label}: 견적 행에 확인 필요와 선택 당시 사유 보존`, true);
      }
      check(
        "저장장치와 쿨러의 확인 필요 선택을 끝까지 검증",
        ["storage", "cooler"].every((category) =>
          reviewed.some((item) => item.category === category),
        ),
      );
      await expect(
        page.getByRole("button", { name: "이 견적으로 확정", exact: true }),
      ).toBeDisabled();
      await expect(page.locator("#pc-quote-handoff")).toBeVisible();
      check("확인 필요 선택이 호환성 통과나 자동 승인으로 변하지 않음", true);
      await page.locator(".pc-quote-screen").scrollIntoViewIfNeeded();
      await capture("quote-review", true);
      await rows.filter({ hasText: reviewed[0].name }).scrollIntoViewIfNeeded();
      await capture("quote-review-row");

      // Keep the page alive: feedback is intentionally memory-only and is reset on refresh.
      await logout();
      await business();
      const afterCount = await feedbackCount();
      result.afterCount = afterCount;
      check(
        "개인 선택이 로그아웃 뒤 기업 실제 집계에 반영",
        afterCount === baselineCount + reviewed.length,
        { baselineCount, afterCount, selectedReviewCount: reviewed.length },
      );
      const feedback = page.getByTestId("review-selection-feedback");
      await expect(feedback).toContainText("상품 정보 보강 필요");
      await expect(feedback).toContainText("실제 시연 집계");
      await capture("feedback-after", true);
      await menu("상담 · 이슈");
      const handoffs = page.getByTestId("review-selection-handoff");
      await expect(handoffs).toHaveCount(1);
      await expect(handoffs.first()).toContainText("실제 시연");
      check("확인 필요 선택을 상담 단위 실제 인계 한 건으로 집계", true);
      await capture("actual-handoff", true);
      await handoffs.first().click();
      const handoff = page.getByTestId("review-selection-handoff-detail");
      await expect(handoff).toBeVisible();
      for (const item of reviewed) {
        await expect(handoff).toContainText(item.name);
        for (const reason of item.unknownReasons) await expect(handoff).toContainText(reason);
      }
      check("기업 인계 상세에 실제 고른 부품과 확인 사유 유지", true);
      await capture("actual-handoff-detail");
    } catch (error) {
      result.flowError = error.message;
      failures.push(`${width}x${height}: ${error.message}`);
      await capture("failure");
    } finally {
      check("브라우저 오류 없음", result.errors.length === 0, { errors: result.errors });
      check("백엔드 호출 없음", result.apiRequests.length === 0, {
        apiRequests: result.apiRequests,
      });
      await writeFile(
        new URL("report.json", output),
        JSON.stringify({ report, failures }, null, 2),
      );
      await context.close();
    }
    console.log(
      JSON.stringify({
        width,
        passed: result.checks.filter((item) => item.passed).length,
        total: result.checks.length,
        flowError: result.flowError,
      }),
    );
  }
} finally {
  await browser.close();
}
console.log(
  JSON.stringify(
    {
      failures,
      screenshots: report.reduce((sum, item) => sum + item.captures.length, 0),
      checks: report.reduce((sum, item) => sum + item.checks.length, 0),
    },
    null,
    2,
  ),
);
expect(failures, "Actual snapshot candidates, retained quote reasons, and seller feedback").toEqual(
  [],
);
