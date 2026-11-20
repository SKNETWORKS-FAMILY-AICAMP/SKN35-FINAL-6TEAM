/** Run from frontend: node src/features/pc-consult/verification/verify-ui.mjs
 * Uses the repository Playwright installation and actual read-only snapshots.
 * Start npm run dev separately. No backend, external payment, or browser UI is used.
 */
/* global document */
import { chromium, expect } from "@playwright/test";
import console from "node:console";
import process from "node:process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";

const baseURL = process.env.PC_CONSULT_URL ?? "http://localhost:5173/?pc-consult=1";
const output = new URL("../../../../test-results/pc-consult/ui/", import.meta.url);
const report = { baseURL, checkedAt: new Date().toISOString(), viewports: [], errors: [] };
const browser = await chromium.launch({ headless: true });
let currentPage;
let currentWidth;

async function keyboardActivate(page, locator) {
  for (let index = 0; index < 60; index += 1) {
    if (await locator.evaluate((element) => element === document.activeElement)) {
      await page.keyboard.press("Enter");
      return;
    }
    await page.keyboard.press("Tab");
  }
  throw new Error(`Keyboard could not reach ${await locator.textContent()}`);
}

async function modalFocusIsContained(page) {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
}

async function capture(page, width, name, viewportReport) {
  await page.evaluate(() => document.fonts.ready);
  const overflow = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    return {
      viewport: width,
      document: document.documentElement.scrollWidth,
      elements: [...document.querySelectorAll(".pc-app *")]
        .filter((element) => element.getBoundingClientRect().right > width + 1)
        .slice(0, 10)
        .map((element) => ({ tag: element.tagName, className: element.className })),
    };
  });
  expect(
    overflow.document,
    `Horizontal overflow ${name}: ${JSON.stringify(overflow)}`,
  ).toBeLessThanOrEqual(overflow.viewport + 1);
  await page.screenshot({
    path: fileURLToPath(new URL(`${width}/${name}.png`, output)),
    fullPage: true,
    animations: "disabled",
  });
  viewportReport.screenshots.push(`${width}/${name}.png`);
}

async function readyForCategory(page, category, editing = false) {
  await expect(
    page.getByRole("heading", {
      name: editing ? `${category}, 다시 골라 주세요.` : `${category} 후보를 골라 주세요.`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".pc-selection")).toHaveAttribute("aria-busy", "false", {
    timeout: 60_000,
  });
  await expect(page.locator(".pc-selection").getByRole("alert")).toHaveCount(0);
  const recommendations = page.locator(".pc-candidate-list .pc-recommendation");
  expect(await recommendations.count()).toBeLessThanOrEqual(1);
  await expect(page.locator(".pc-unknown .pc-recommendation")).toHaveCount(0);
  if (await recommendations.count())
    await expect(page.locator(".pc-candidate-list > article").first()).toHaveClass(
      /pc-recommended/,
    );
}

async function openUnknown(page) {
  const group = page.getByTestId("pc-unknown");
  if (!(await group.getAttribute("open")) && (await group.getAttribute("open")) !== "")
    await group.locator("summary").click();
  await expect(group).toHaveAttribute("open", "");
  return group;
}

async function selectCandidate(page, viewportReport, category) {
  const passed = page.locator(".pc-candidate-list > article");
  if (await passed.count()) {
    const first = passed.first();
    viewportReport.selections.push({
      category,
      group: "passed",
      source_key: await first.getAttribute("data-source-key"),
    });
    await first.getByRole("button").click();
  } else {
    const group = await openUnknown(page);
    const first = group.getByTestId("pc-candidate").first();
    await expect(first).toBeVisible();
    viewportReport.selections.push({
      category,
      group: "needsReview",
      source_key: await first.getAttribute("data-source-key"),
    });
    await first.getByRole("button").click();
    await modalFocusIsContained(page);
    await page.getByRole("button", { name: "주의사항을 확인하고 선택", exact: true }).click();
  }
}

async function confirmQuote(page) {
  await page.getByRole("button", { name: "이 견적으로 확정", exact: true }).click();
  await modalFocusIsContained(page);
  await page.getByRole("button", { name: "확인하고 시연 저장", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "선택하신 견적을 저장했어요.", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("시연 저장 (DB에 기록 안 됨) · 새로고침하면 내역이 사라집니다.", {
      exact: true,
    }),
  ).toBeVisible();
}

try {
  for (const width of [1440, 360]) {
    currentWidth = width;
    await mkdir(new URL(`${width}/`, output), { recursive: true });
    const context = await browser.newContext({
      viewport: { width, height: width === 360 ? 800 : 1000 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    currentPage = page;
    page.setDefaultTimeout(20_000);
    const viewportReport = {
      width,
      screenshots: [],
      selections: [],
      snapshotRequests: {},
      apiRequests: [],
      pageErrors: [],
    };
    report.viewports.push(viewportReport);
    const fetches = {};
    page.on("pageerror", (error) => viewportReport.pageErrors.push(error.message));
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/api/")) viewportReport.apiRequests.push(url.pathname);
      if (url.pathname.startsWith("/demo-data/"))
        fetches[url.pathname] = (fetches[url.pathname] ?? 0) + 1;
    });

    await page.goto(baseURL);
    await expect(
      page.getByRole("heading", { name: "어떤 계정으로 시작할까요?", exact: true }),
    ).toBeVisible();
    await capture(page, width, "00-account-type", viewportReport);
    await keyboardActivate(page, page.getByRole("button", { name: /개인 부품 교체와 새 PC/ }));
    await capture(page, width, "01-login-personal", viewportReport);
    await keyboardActivate(page, page.getByRole("button", { name: "기업용", exact: true }));
    await expect(page.getByLabel("시연 기업", { exact: true })).toBeVisible();
    await capture(page, width, "02-login-business", viewportReport);
    await keyboardActivate(page, page.getByRole("button", { name: "개인용", exact: true }));
    await keyboardActivate(page, page.getByRole("button", { name: /개인용 시연으로 시작/ }));
    await expect(
      page.getByRole("heading", { name: "어떤 PC가 필요하세요?", exact: true }),
    ).toBeVisible();
    await capture(page, width, "03-consultation-type", viewportReport);
    await keyboardActivate(page, page.getByRole("button", { name: /신규 PC 조립/ }));
    await expect(
      page.getByRole("heading", { name: "어떤 PC를 만들고 싶으세요?", exact: true }),
    ).toBeVisible();
    await page.getByLabel("얼마까지 생각하고 계세요?", { exact: true }).fill("5000000");
    await page.getByRole("checkbox", { name: /고사양 게임/ }).check();
    await capture(page, width, "04-survey", viewportReport);
    await page.getByRole("button", { name: /입력 내용 확인/ }).click();
    await page.getByRole("button", { name: /상담 시작/ }).click();
    await readyForCategory(page, "CPU");
    await expect(
      page.getByText("추천 기준: 가격 낮은 순 (판매량 데이터 준비 중)", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".pc-candidate-list .pc-recommendation")).toHaveCount(1);
    await capture(page, width, "05-candidates-ai-recommendation", viewportReport);

    await page.getByRole("button", { name: /이 부품에 예산 더 쓰기/ }).click();
    await page.getByLabel("이 부품 예산", { exact: true }).fill("1200000");
    await page.getByRole("button", { name: "새 후보와 배분 확인", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "새 한도로 찾은 후보", exact: true }),
    ).toBeVisible();
    await capture(page, width, "06-budget-reallocation", viewportReport);
    await page.getByRole("button", { name: "이 한도로 후보 보기", exact: true }).click();

    const categories = [
      "CPU",
      "메인보드",
      "RAM",
      "GPU",
      "저장장치",
      "쿨러",
      "파워서플라이",
      "케이스",
    ];
    for (const category of categories) {
      await readyForCategory(page, category);
      if (category === "저장장치") {
        await openUnknown(page);
        await capture(page, width, "07-needs-further-verification", viewportReport);
      }
      await selectCandidate(page, viewportReport, category);
    }

    await expect(
      page.getByRole("heading", { name: "이 구성이 어떠세요?", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".pc-version")).toHaveText("견적 v1");
    await expect(page.locator(".pc-quote-table tbody tr")).toHaveCount(8);
    await capture(page, width, "08-quote-v1", viewportReport);
    await confirmQuote(page);
    await expect(page.getByRole("button", { name: /결제 안내로 이동/ })).toHaveCount(0);
    await page.getByRole("button", { name: "견적과 버전 이력 보기", exact: true }).click();
    await page.getByRole("button", { name: "케이스 변경 요청", exact: true }).click();
    await modalFocusIsContained(page);
    await page.getByLabel("원하는 색상", { exact: true }).selectOption("White");
    await page.getByLabel("바라는 조건", { exact: true }).fill("흰색 케이스를 원합니다.");
    await page.getByRole("button", { name: "설계팀에 변경 요청", exact: true }).click();
    await readyForCategory(page, "케이스", true);
    await selectCandidate(page, viewportReport, "케이스 변경");
    await expect(page.locator(".pc-version")).toHaveText("견적 v2");
    await expect(
      page.getByText("구성이 변경되어 다시 승인이 필요합니다. 이전 버전은 이력에 남아 있습니다.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.locator(".pc-history-item")).toHaveCount(2);
    await expect(page.locator(".pc-history-item").first()).toContainText("승인 완료");
    await capture(page, width, "09-quote-v2-reapproval", viewportReport);
    await confirmQuote(page);
    await capture(page, width, "10-confirmed", viewportReport);
    for (const path of [
      "/demo-data/parts.snapshot.json",
      "/demo-data/part_compatibility.snapshot.json",
    ])
      expect(fetches[path], `Snapshot fetched once: ${path}`).toBe(1);
    viewportReport.snapshotRequests.newAssembly = { ...fetches };

    await page.reload();
    await page.getByRole("button", { name: /개인 부품 교체와 새 PC/ }).click();
    await page.getByRole("button", { name: /개인용 시연으로 시작/ }).click();
    await page.getByRole("button", { name: /기존 PC 부품 교체/ }).click();
    await page.getByLabel("얼마까지 생각하고 계세요?", { exact: true }).fill("500000");
    await page.getByRole("checkbox", { name: /고사양 게임/ }).check();
    const ownedCPU = page
      .locator(".pc-owned")
      .filter({ has: page.locator("summary strong", { hasText: /^CPU$/ }) });
    await ownedCPU.locator("summary").click();
    await ownedCPU
      .getByLabel("목록에 없다면 직접 입력", { exact: true })
      .fill("보유 CPU (모델 미확인)");
    await ownedCPU.getByRole("button", { name: "추가", exact: true }).click();
    await expect(ownedCPU.locator("summary")).toContainText("미확인");
    await page.getByRole("checkbox", { name: "저장 공간이 부족해요", exact: true }).check();
    await page.getByRole("button", { name: /입력 내용 확인/ }).click();
    await page.getByRole("button", { name: /상담 시작/ }).click();
    await readyForCategory(page, "저장장치");
    await expect(page.locator(".pc-candidate-list .pc-recommendation")).toHaveCount(0);
    await selectCandidate(page, viewportReport, "부품 교체 저장장치");
    await expect(
      page.getByRole("heading", { name: "이 구성이 어떠세요?", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".pc-quote-table tbody tr")).toHaveCount(1);
    await confirmQuote(page);
    await page.getByRole("button", { name: /결제 안내로 이동/ }).click();
    await expect(page.getByRole("heading", { name: "결제 연동 예정", exact: true })).toBeVisible();
    await expect(page.locator(".pc-payment input")).toHaveCount(0);
    await capture(page, width, "11-payment-placeholder", viewportReport);
    for (const path of [
      "/demo-data/parts.snapshot.json",
      "/demo-data/part_compatibility.snapshot.json",
    ])
      expect(fetches[path], `Once each session: ${path}`).toBe(2);
    viewportReport.snapshotRequests.totalTwoSessions = { ...fetches };
    expect(viewportReport.apiRequests).toEqual([]);
    expect(viewportReport.pageErrors).toEqual([]);
    console.log(
      `PASS ${width}px: ${viewportReport.screenshots.length} screenshots; new assembly, revision, confirmation, replacement payment, keyboard, overflow, no API calls`,
    );
    await context.close();
  }
} catch (error) {
  report.errors.push(error.stack ?? String(error));
  if (currentPage && !currentPage.isClosed()) {
    await currentPage
      .screenshot({
        path: fileURLToPath(new URL(`${currentWidth}/failure.png`, output)),
        fullPage: true,
      })
      .catch(() => undefined);
  }
  console.error(error);
  process.exitCode = 1;
} finally {
  await writeFile(
    new URL("ui-report.json", output),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  await browser.close();
}
