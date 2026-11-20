/** Voice-panel intake placement and preserved consultation state.
 * Run from frontend after npm run dev:
 * node src/features/pc-consult/verification/verify-voice-survey.mjs
 * Uses repository Playwright and the supplied read-only snapshots; no backend or microphone.
 */
/* global document, window */
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import console from "node:console";
import process from "node:process";

const baseURL = new URL(process.env.PC_CONSULT_URL ?? "http://localhost:5173/");
baseURL.search = "?pace=300";
const widths = (process.env.VOICE_SURVEY_VIEWPORTS ?? "1440,1024,360").split(",").map(Number);
if (!widths.length || widths.some((width) => ![1440, 1024, 360].includes(width)))
  throw new Error("VOICE_SURVEY_VIEWPORTS must contain 1440, 1024, or 360 separated by commas.");
const output = new URL("../../../../test-results/pc-consult/voice-survey/", import.meta.url);
const report = {
  checkedAt: new Date().toISOString(),
  baseURL: baseURL.href,
  viewports: [],
  errors: [],
};
const chatMemo = "화면 배치 검증용 요청 메모입니다. 설문을 고쳐도 대화에 남겨 주세요.";
const replacementMemo = "저장 공간을 늘리고 싶어요. 설문 상태 보존 검증용 메모입니다.";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
let page;
let current;

function intake() {
  return page.locator("#conversation .pc-intake-slot");
}

async function assertSingleWorkspace() {
  await expect(page.locator("#conversation")).toHaveCount(1);
  await expect(page.locator("#pc-main-content")).toHaveCount(1);
  await expect(page.locator(".office-board")).toHaveCount(1);
  await expect(page.locator("svg.office-art")).toHaveCount(1);
  await expect(page.locator("#conversation [data-testid=chat-log]")).toBeVisible();
}

async function assertIntake(selector) {
  await assertSingleWorkspace();
  await expect(intake()).toBeVisible();
  await expect(intake().locator(selector)).toHaveCount(1);
  await expect(intake().locator(selector)).toBeVisible();
  await expect(page.locator(`#results ${selector}`)).toHaveCount(0);
  expect(
    await page
      .locator(selector)
      .evaluate((element) => Boolean(element.closest("#conversation .pc-intake-slot"))),
    `${selector} must be rendered inside the voice-panel intake slot`,
  ).toBe(true);
}

async function assertResults(selector) {
  await assertSingleWorkspace();
  await expect(page.locator(`#results ${selector}`)).toHaveCount(1);
  await expect(page.locator(`#results ${selector}`)).toBeVisible();
  await expect(page.locator(`#conversation ${selector}`)).toHaveCount(0);
  expect(
    await page
      .locator("#pc-main-content")
      .evaluate((element) => Boolean(element.closest("#results"))),
    "The one consultation body must move into results for candidate and quotation screens",
  ).toBe(true);
}

async function assertMemoPreserved() {
  const memo = page.getByTestId("chat-user").filter({ hasText: chatMemo });
  await expect(memo).toHaveCount(1);
  await expect(memo).toContainText(chatMemo);
}

async function capture(stage) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.evaluate(() => document.fonts.ready);
  const overflow = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    outside: [...document.querySelectorAll(".app-shell *")]
      .filter(
        (element) =>
          element.getBoundingClientRect().right > document.documentElement.clientWidth + 1,
      )
      .slice(0, 8)
      .map((element) => ({ tag: element.tagName, className: element.getAttribute("class") })),
  }));
  expect(
    overflow.document,
    `${stage} document overflow: ${JSON.stringify(overflow)}`,
  ).toBeLessThanOrEqual(overflow.viewport);
  expect(overflow.body, `${stage} body overflow: ${JSON.stringify(overflow)}`).toBeLessThanOrEqual(
    overflow.viewport,
  );
  const file = `voice-survey-${current.width}-${stage}.png`;
  await page.screenshot({
    path: fileURLToPath(new URL(file, output)),
    fullPage: true,
    animations: "disabled",
  });
  current.screenshots.push({ stage, file, overflow });
}

async function assertResponsiveLayout() {
  const office = await page.locator(".consultation-workspace > .office-board").boundingBox();
  const conversation = await page.locator("#conversation").boundingBox();
  expect(office).not.toBeNull();
  expect(conversation).not.toBeNull();
  if (current.width === 1440) {
    expect(Math.abs(office.y - conversation.y)).toBeLessThanOrEqual(4);
    expect(office.x + office.width).toBeLessThanOrEqual(conversation.x + 1);
    const ratio = conversation.width / office.width;
    expect(
      ratio,
      "Desktop office and expanded voice panel should be approximately equal width",
    ).toBeGreaterThanOrEqual(0.8);
    expect(ratio).toBeLessThanOrEqual(1.25);
  } else {
    expect(
      conversation.y,
      "Tablet and mobile panels should stack vertically",
    ).toBeGreaterThanOrEqual(office.y + office.height - 1);
    expect(Math.abs(office.x - conversation.x)).toBeLessThanOrEqual(4);
  }
  current.layout = { office, conversation };
}

async function assertNewSurveyValues(budget = "5,000,000") {
  await assertIntake(".pc-survey");
  await expect(intake().getByLabel("얼마까지 생각하고 계세요?", { exact: true })).toHaveValue(
    budget,
  );
  await expect(intake().getByRole("checkbox", { name: /고사양 게임/ })).toBeChecked();
  await expect(intake().getByRole("checkbox", { name: /동영상 편집/ })).toBeChecked();
  await expect(intake().getByLabel("목표 해상도")).toHaveValue("qhd");
  await expect(intake().getByLabel("목표 프레임")).toHaveValue("144");
  await expect(intake().getByLabel("작업 규모")).toHaveValue("large");
  await assertMemoPreserved();
}

async function readyForCandidates(category) {
  await expect(
    page.getByRole("heading", { name: `${category} 후보를 골라 주세요.`, exact: true }),
  ).toBeVisible();
  await expect(page.locator(".pc-selection")).toHaveAttribute("aria-busy", "false", {
    timeout: 60_000,
  });
  await expect(page.locator(".pc-selection").getByRole("alert")).toHaveCount(0);
  await assertResults(".pc-selection");
  await expect(intake().locator(".pc-survey, .pc-review, .pc-type-screen")).toHaveCount(0);
  await assertMemoPreserved();
}

async function selectActualCandidate() {
  let card = page.locator("#results .pc-candidate-list > article").first();
  let unknown = false;
  if (!(await card.count())) {
    unknown = true;
    const group = page.getByTestId("pc-unknown");
    if ((await group.getAttribute("open")) === null) await group.locator("summary").click();
    card = group.getByTestId("pc-candidate").first();
  }
  await expect(card).toBeVisible();
  current.replacementCandidate = {
    source_key: await card.getAttribute("data-source-key"),
    name: await card.getByRole("heading", { level: 3 }).innerText(),
    unknown,
  };
  await card.getByRole("button").click();
  if (unknown)
    await page.getByRole("button", { name: "주의사항을 확인하고 선택", exact: true }).click();
}

try {
  for (const width of widths) {
    const context = await browser.newContext({
      viewport: { width, height: width === 360 ? 800 : 1000 },
      reducedMotion: "reduce",
    });
    page = await context.newPage();
    page.setDefaultTimeout(25_000);
    current = {
      width,
      screenshots: [],
      checks: [],
      pageErrors: [],
      apiRequests: [],
      snapshotRequests: {},
    };
    report.viewports.push(current);
    page.on("pageerror", (error) => current.pageErrors.push(error.message));
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/api/") || request.method() !== "GET")
        current.apiRequests.push(`${request.method()} ${url.pathname}`);
      if (url.pathname.startsWith("/demo-data/"))
        current.snapshotRequests[url.pathname] = (current.snapshotRequests[url.pathname] ?? 0) + 1;
    });
    await page.goto(baseURL.href);
    await page.getByRole("button", { name: /개인 부품 교체와 새 PC/ }).click();
    await page.getByRole("button", { name: /개인용 시연으로 시작/ }).click();
    await assertIntake(".pc-type-screen");
    await assertResponsiveLayout();
    await capture("01-type-in-voice");

    await page.getByTestId("chat-input").fill(chatMemo);
    await page.getByTestId("chat-send").click();
    await assertMemoPreserved();
    await intake()
      .getByRole("button", { name: /신규 PC 조립/ })
      .click();
    await assertIntake(".pc-survey");
    await intake().getByLabel("얼마까지 생각하고 계세요?", { exact: true }).fill("5000000");
    await intake()
      .getByRole("checkbox", { name: /고사양 게임/ })
      .check();
    await intake()
      .getByRole("checkbox", { name: /동영상 편집/ })
      .check();
    await intake().getByLabel("목표 해상도").selectOption("qhd");
    await intake().getByLabel("목표 프레임").selectOption("144");
    await intake().getByLabel("작업 규모").selectOption("large");
    await capture("02-new-survey-in-voice");
    await intake()
      .getByRole("button", { name: /입력 내용 확인/ })
      .click();
    await assertIntake(".pc-review");
    await expect(intake().locator(".pc-review")).toContainText("₩5,000,000");
    await expect(intake().locator(".pc-review")).toContainText("QHD · 144 FPS 목표");
    await assertMemoPreserved();
    await capture("03-new-review-in-voice");
    await intake().getByRole("button", { name: "입력 내용 고치기", exact: true }).click();
    await assertNewSurveyValues();
    await intake().getByLabel("얼마까지 생각하고 계세요?", { exact: true }).fill("5200000");
    await intake()
      .getByRole("button", { name: /입력 내용 확인/ })
      .click();
    await assertIntake(".pc-review");
    await expect(intake().locator(".pc-review")).toContainText("₩5,200,000");
    await intake()
      .getByRole("button", { name: /상담 시작/ })
      .click();
    await readyForCandidates("CPU");
    await expect(page.locator("#results .pc-candidate-list .pc-recommendation")).toHaveCount(1);
    await capture("04-new-candidates-in-results");
    await page
      .locator("#results .pc-bottom-actions")
      .getByRole("button", { name: /이전 단계/ })
      .click();
    await assertNewSurveyValues("5,200,000");
    await capture("05-new-survey-restored");
    current.checks.push(
      "New build survey/review stay in voice intake; edits and candidate-to-survey navigation preserve budget, purposes, performance, and user chat.",
    );

    await intake().getByRole("button", { name: "이전으로", exact: true }).click();
    await assertIntake(".pc-type-screen");
    await assertMemoPreserved();
    await intake()
      .getByRole("button", { name: /기존 PC 부품 교체/ })
      .click();
    await assertIntake(".pc-survey");
    await expect(
      intake().getByRole("heading", { name: "지금 쓰는 PC, 무엇이 아쉬우세요?", exact: true }),
    ).toBeVisible();
    await intake().getByLabel("얼마까지 생각하고 계세요?", { exact: true }).fill("1200000");
    await intake().getByRole("checkbox", { name: /기타/ }).check();
    const cpu = intake()
      .locator(".pc-owned")
      .filter({ has: page.locator("summary > strong", { hasText: /^CPU$/ }) });
    await cpu.locator("summary").click();
    await cpu.locator(".pc-search-results button").first().click();
    const ownedName = await cpu.locator("summary > span").first().innerText();
    current.ownedPartName = ownedName;
    await intake().getByRole("checkbox", { name: "저장 공간이 부족해요", exact: true }).check();
    await intake().locator("#pc-problem-note").fill(replacementMemo);
    await capture("06-replacement-survey-in-voice");
    await intake()
      .getByRole("button", { name: /입력 내용 확인/ })
      .click();
    await assertIntake(".pc-review");
    await expect(intake().locator(".pc-review")).toContainText(ownedName);
    await expect(intake().locator(".pc-review")).toContainText(replacementMemo);
    await capture("07-replacement-review-in-voice");
    await intake().getByRole("button", { name: "입력 내용 고치기", exact: true }).click();
    await assertIntake(".pc-survey");
    await expect(intake().getByLabel("얼마까지 생각하고 계세요?", { exact: true })).toHaveValue(
      "1,200,000",
    );
    await expect(intake().getByRole("checkbox", { name: /기타/ })).toBeChecked();
    await expect(cpu.locator("summary")).toContainText(ownedName);
    await expect(
      intake().getByRole("checkbox", { name: "저장 공간이 부족해요", exact: true }),
    ).toBeChecked();
    await expect(intake().locator("#pc-problem-note")).toHaveValue(replacementMemo);
    await assertMemoPreserved();
    await intake()
      .getByRole("button", { name: /입력 내용 확인/ })
      .click();
    await intake()
      .getByRole("button", { name: /상담 시작/ })
      .click();
    await readyForCandidates("저장장치");
    await capture("08-replacement-candidates-in-results");
    await selectActualCandidate();
    await expect(
      page.getByRole("heading", { name: "이 구성이 어떠세요?", exact: true }),
    ).toBeVisible({ timeout: 60_000 });
    await assertResults(".pc-quote-screen");
    await expect(page.locator(".office-printout")).toHaveCount(0);
    await assertMemoPreserved();
    await capture("09-quotation-in-results");
    current.checks.push(
      "Replacement survey/review retain the selected snapshot part, problem, budget, memo, and existing conversation; candidates and draft quote render only in results.",
    );
    expect(current.pageErrors).toEqual([]);
    expect(current.apiRequests).toEqual([]);
    for (const count of Object.values(current.snapshotRequests)) expect(count).toBe(1);
    current.checks.push(
      "Exactly one consultation body and office scene; no horizontal page overflow, backend requests, duplicate snapshot fetches, or browser errors.",
    );
    console.log(
      `PASS voice survey ${width}px: ${current.screenshots.length} screenshots, intake/results containment, preserved survey and chat, no horizontal overflow`,
    );
    await context.close();
  }
} catch (error) {
  report.errors.push(error.stack ?? String(error));
  if (page && !page.isClosed())
    await page
      .screenshot({
        path: fileURLToPath(
          new URL(`voice-survey-${current?.width ?? "unknown"}-failure.png`, output),
        ),
        fullPage: true,
      })
      .catch(() => undefined);
  console.error(error);
  process.exitCode = 1;
} finally {
  const suffix = process.env.VOICE_SURVEY_VIEWPORTS ? `-${widths.join("-")}` : "";
  await writeFile(
    new URL(`voice-survey-report${suffix}.json`, output),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  await browser.close();
}
