/** Existing office + PC consultation integration, using real read-only snapshots.
 * Run from frontend after npm run dev:
 * node src/features/pc-consult/verification/verify-office.mjs
 * Uses only the repository Playwright installation. No backend or browser UI control.
 */
/* global document, window, MutationObserver, performance, requestAnimationFrame */
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import console from "node:console";
import process from "node:process";

const baseURL = new URL(process.env.PC_CONSULT_URL ?? "http://localhost:5173/");
baseURL.search = "?pace=300";
const output = new URL("./office/", import.meta.url);
const businessOnly = process.env.OFFICE_BUSINESS_ONLY === "1";
const widths = (process.env.OFFICE_VIEWPORTS ?? "1440,1024,360").split(",").map(Number);
if (!widths.length || widths.some((value) => ![1440, 1024, 360].includes(value)))
  throw new Error("OFFICE_VIEWPORTS must contain 1440, 1024, or 360 separated by commas.");
const reportFile = businessOnly
  ? `integration-report-business-${widths.join("-")}.json`
  : process.env.OFFICE_VIEWPORTS
    ? `integration-report-${widths.join("-")}.json`
    : "integration-report.json";
const report = {
  checkedAt: new Date().toISOString(),
  baseURL: baseURL.href,
  scope: businessOnly ? "business-office-only" : "full-integration",
  viewports: [],
  legacySmoke: [],
  errors: [],
};
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
let page;
let width;
let current;

async function keyboardActivate(locator) {
  for (let index = 0; index < 60; index += 1) {
    if (await locator.evaluate((element) => element === document.activeElement)) {
      await page.keyboard.press("Enter");
      return;
    }
    await page.keyboard.press("Tab");
  }
  throw new Error(`Keyboard could not reach ${await locator.textContent()}`);
}

async function modalFocusIsContained() {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
}

async function capture(name, animations = "disabled") {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.evaluate(() => document.fonts.ready);
  const bounds = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    outside: [...document.querySelectorAll(".app-shell *")]
      .filter(
        (element) =>
          element.getBoundingClientRect().right > document.documentElement.clientWidth + 1,
      )
      .slice(0, 10)
      .map((element) => ({ tag: element.tagName, className: element.getAttribute("class") })),
  }));
  expect(bounds.document, `${name} overflow: ${JSON.stringify(bounds)}`).toBeLessThanOrEqual(
    bounds.viewport + 1,
  );
  const file = `after-${width}-${name}.png`;
  await page.screenshot({
    path: fileURLToPath(new URL(file, output)),
    fullPage: true,
    animations,
  });
  current.screenshots.push(file);
}

async function readyForCategory(category, editing = false) {
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
  const recommended = page.locator(".pc-candidate-list .pc-recommendation");
  expect(await recommended.count()).toBeLessThanOrEqual(1);
  await expect(page.locator(".pc-unknown .pc-recommendation")).toHaveCount(0);
  if (await recommended.count())
    await expect(page.locator(".pc-candidate-list > article").first()).toHaveClass(
      /pc-recommended/,
    );
}

async function selectCandidate(category) {
  const passed = page.locator(".pc-candidate-list > article");
  let card;
  let group = "passed";
  if (await passed.count()) card = passed.first();
  else {
    group = "needsReview";
    const unknown = page.getByTestId("pc-unknown");
    if ((await unknown.getAttribute("open")) === null) await unknown.locator("summary").click();
    card = unknown.getByTestId("pc-candidate").first();
  }
  await expect(card).toBeVisible();
  const name = await card.getByRole("heading", { level: 3 }).innerText();
  const key = await card.getAttribute("data-source-key");
  await card.getByRole("button").click();
  if (group === "needsReview") {
    await modalFocusIsContained();
    await page.getByRole("button", { name: "주의사항을 확인하고 선택", exact: true }).click();
  }
  await expect(page.getByTestId("chat-user").filter({ hasText: name }).last()).toBeVisible();
  current.selections.push({ category, group, source_key: key, name, recordedInChat: true });
}

async function confirmQuote(version) {
  await page.getByRole("button", { name: "이 견적으로 확정", exact: true }).click();
  await modalFocusIsContained();
  await page.getByRole("button", { name: "확인하고 시연 저장", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "선택하신 견적을 저장했어요.", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".office-printout")).toBeVisible();
  await expect(page.getByTestId("run-status")).toHaveClass(/status-completed/);
  await expect(page.locator(".office-quote-value")).toContainText(`견적 v${version}`);
  await expect(
    page.getByTestId("chat-assistant").filter({ hasText: `견적 v${version}을 시연 저장했습니다.` }),
  ).toHaveCount(1);
}

async function observeSequence() {
  await page.evaluate(() => {
    const target = document.querySelector('[data-testid="connection"]');
    window.__pcObservedSequence = [];
    const record = () => {
      const match = target?.textContent?.match(/기록 (\d+)건/);
      if (!match) return;
      const value = Number(match[1]);
      if (window.__pcObservedSequence.at(-1) !== value) window.__pcObservedSequence.push(value);
    };
    record();
    new MutationObserver(record).observe(target, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
}

async function businessNav(name, locked = false) {
  const target = page.locator(".app-rail .business-nav").getByRole("button", {
    name: locked ? new RegExp(`^${name}`) : name,
    exact: !locked,
    includeHidden: true,
  });
  if (!(await target.isVisible())) await page.locator(".shell-menu-toggle").click();
  await target.click();
  if (locked) await expect(target).not.toHaveAttribute("aria-current", "page");
  else await expect(target).toHaveAttribute("aria-current", "page");
}

async function demo(label, wait = true) {
  const toggle = page.locator(".seller-demo-toggle");
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  const controls = page.getByRole("complementary", { name: "시연 제어", exact: true });
  await controls.getByRole("button", { name: label, exact: true }).click();
  if (wait)
    await expect(
      controls.getByRole("button", { name: "전체 시나리오 자동 재생", exact: true }),
    ).toBeEnabled({ timeout: 15_000 });
  await toggle.click();
}

function track(page, item) {
  page.on("pageerror", (error) => item.pageErrors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/") || request.method() !== "GET")
      item.apiRequests.push(`${request.method()} ${url.pathname}`);
    if (item.snapshotRequests && url.pathname.startsWith("/demo-data/"))
      item.snapshotRequests[url.pathname] = (item.snapshotRequests[url.pathname] ?? 0) + 1;
  });
}

try {
  for (width of widths) {
    const context = await browser.newContext({
      viewport: { width, height: width === 360 ? 800 : 1000 },
      reducedMotion: "reduce",
    });
    page = await context.newPage();
    page.setDefaultTimeout(25_000);
    current = {
      width,
      screenshots: [],
      selections: [],
      checks: [],
      snapshotRequests: {},
      pageErrors: [],
      apiRequests: [],
      observedSequence: [],
    };
    report.viewports.push(current);
    track(page, current);
    await page.goto(baseURL.href);
    await expect(
      page.getByRole("heading", { name: "어떤 계정으로 시작할까요?", exact: true }),
    ).toBeVisible();
    if (!businessOnly) {
      await capture("00-start");
      await keyboardActivate(page.getByRole("button", { name: /개인 부품 교체와 새 PC/ }));
      await keyboardActivate(page.getByRole("button", { name: /개인용 시연으로 시작/ }));
      await expect(
        page.getByRole("heading", { name: "어떤 PC가 필요하세요?", exact: true }),
      ).toBeVisible();
      await expect(page.locator(".office-board")).toHaveCount(1);
      await expect(page.getByTestId("chat-log")).toBeVisible();
      await expect(page.locator(".office-printout")).toHaveCount(0);
      await observeSequence();
      await capture("01-personal-office-type");
      await page.getByTestId("chat-input").fill("흰색 부품을 선호해요. 요청 메모입니다.");
      await page.getByTestId("chat-send").click();
      await expect(page.getByTestId("chat-user").last()).toContainText("요청 메모입니다.");
      await expect(page.getByTestId("chat-assistant").last()).toContainText(
        "메모만으로 추천이나 견적이 바뀌지 않습니다.",
      );
      await expect(
        page.getByRole("heading", { name: "어떤 PC가 필요하세요?", exact: true }),
      ).toBeVisible();
      await keyboardActivate(page.getByRole("button", { name: /신규 PC 조립/ }));
      await page.getByLabel("얼마까지 생각하고 계세요?", { exact: true }).fill("5000000");
      await page.getByRole("checkbox", { name: /고사양 게임/ }).check();
      await capture("02-personal-survey");
      await page.getByRole("button", { name: /입력 내용 확인/ }).click();
      await expect(page.getByTestId("chat-user").last()).toContainText("₩5,000,000");
      await page.getByRole("button", { name: /상담 시작/ }).click();
      // Capture actual aggregate validation while the candidate UI is still pending.
      await page.waitForFunction(
        () =>
          Boolean(
            document.querySelector('[data-testid="desk-validation"].status-running') &&
            document.querySelector('.pc-selection[aria-busy="true"]'),
          ),
        undefined,
        { timeout: 30_000 },
      );
      await capture("03-validation-running");
      current.checks.push(
        "Captured actual validation-running office event while candidates remain pending",
      );
      await readyForCategory("CPU");
      await expect(page.locator(".pc-candidate-list .pc-recommendation")).toHaveCount(1);
      await expect(
        page.getByText("추천 기준: 가격 낮은 순 (판매량 데이터 준비 중)", { exact: true }),
      ).toBeVisible();
      await capture("04-passed-candidates");
      await page.getByRole("button", { name: /이 부품에 예산 더 쓰기/ }).click();
      await page.getByLabel("이 부품 예산", { exact: true }).fill("1200000");
      await page.getByRole("button", { name: "새 후보와 배분 확인", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "새 한도로 찾은 후보", exact: true }),
      ).toBeVisible();
      await capture("04b-budget-reallocation");
      await page.getByRole("button", { name: "이 한도로 후보 보기", exact: true }).click();
      for (const category of [
        "CPU",
        "메인보드",
        "RAM",
        "GPU",
        "저장장치",
        "쿨러",
        "파워서플라이",
        "케이스",
      ]) {
        await readyForCategory(category);
        if (category === "저장장치") {
          const unknown = page.getByTestId("pc-unknown");
          if ((await unknown.getAttribute("open")) === null)
            await unknown.locator("summary").click();
          await capture("04c-needs-review");
        }
        await selectCandidate(category);
      }
      await expect(
        page.getByRole("heading", { name: "이 구성이 어떠세요?", exact: true }),
      ).toBeVisible();
      await expect(page.locator(".pc-version")).toHaveText("견적 v1");
      await expect(page.locator(".pc-quote-table tbody tr")).toHaveCount(8);
      await expect(page.locator(".office-printout")).toHaveCount(0);
      await expect(page.getByTestId("run-status")).toHaveClass(/status-needs_input/);
      await capture("05-quote-v1-awaiting-approval");
      await confirmQuote(1);
      await capture("06-confirmed-printout");
      const beforeEditSequence = await page.evaluate(() => window.__pcObservedSequence.at(-1));
      await page.getByRole("button", { name: "견적과 버전 이력 보기", exact: true }).click();
      await page.getByRole("button", { name: "케이스 변경 요청", exact: true }).click();
      await page.getByLabel("원하는 색상", { exact: true }).selectOption("White");
      await page.getByLabel("바라는 조건", { exact: true }).fill("흰색 케이스를 원합니다.");
      await page.getByRole("button", { name: "설계팀에 변경 요청", exact: true }).click();
      await readyForCategory("케이스", true);
      await expect(page.locator(".office-printout")).toHaveCount(0);
      await selectCandidate("케이스 변경");
      await expect(page.locator(".pc-version")).toHaveText("견적 v2");
      await expect(page.locator(".pc-history-item")).toHaveCount(2);
      await expect(page.locator(".pc-history-item").first()).toContainText("승인 완료");
      await expect(page.getByTestId("run-status")).toHaveClass(/status-needs_input/);
      await expect(page.locator(".office-printout")).toHaveCount(0);
      await capture("07-quote-v2-reapproval");
      await confirmQuote(2);
      await capture("08-confirmed-v2");
      current.observedSequence = await page.evaluate(() => window.__pcObservedSequence);
      expect(current.observedSequence.at(-1)).toBeGreaterThan(beforeEditSequence);
      for (let index = 1; index < current.observedSequence.length; index += 1)
        expect(current.observedSequence[index]).toBeGreaterThan(
          current.observedSequence[index - 1],
        );
      current.checks.push(
        "Accepted choices and memo appear in existing chat; sequence remains monotonic across quote revision",
        "Printer remains hidden before approval; v1 and v2 print only after save; prior confirmed version retained",
        "Tab/Enter reaches personal entry and consultation type; warning and confirmation dialogs retain keyboard focus",
      );
      for (const name of ["parts.snapshot.json", "part_compatibility.snapshot.json"])
        expect(current.snapshotRequests[`/demo-data/${name}`]).toBe(1);

      await page.getByRole("button", { name: "로그아웃", exact: true }).click();
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
      await readyForCategory("저장장치");
      await expect(page.locator(".pc-candidate-list .pc-recommendation")).toHaveCount(0);
      await selectCandidate("부품 교체 저장장치");
      await expect(
        page.getByRole("heading", { name: "이 구성이 어떠세요?", exact: true }),
      ).toBeVisible();
      await expect(page.locator(".pc-quote-table tbody tr")).toHaveCount(1);
      await confirmQuote(1);
      await page.getByRole("button", { name: /결제 안내로 이동/ }).click();
      await expect(
        page.getByRole("heading", { name: "결제 연동 예정", exact: true }),
      ).toBeVisible();
      await expect(page.locator(".pc-payment input")).toHaveCount(0);
      await capture("08b-replacement-payment");
      current.checks.push(
        "Replacement targets storage only; unknown warns; saved quote leads to payment placeholder with no payment fields",
      );
      for (const name of ["parts.snapshot.json", "part_compatibility.snapshot.json"])
        expect(current.snapshotRequests[`/demo-data/${name}`]).toBe(1);
      await page.getByRole("button", { name: "로그아웃", exact: true }).click();
    }
    await page.getByRole("button", { name: /기업 AI 고객센터와 판매 현황을 관리해요/ }).click();
    await page.getByRole("button", { name: "관리자로 시연", exact: true }).click();
    await expect(page.locator(".seller-metric")).toHaveCount(4);
    if (!businessOnly) {
      await capture("09a-business-home");
      for (const [menu, heading, file] of [
        ["고객 정보", "고객 정보", "customers"],
        ["판매 통계", "판매 현황", "sales"],
        ["상담 · 이슈 현황", "이슈 / 클레임 / 오류", "issues"],
        ["문서 · 정책 관리", "사내 문서 / 정책", "documents"],
        ["직원 관리", "직원 관리", "employees"],
      ]) {
        await businessNav(menu);
        await expect(
          page.getByRole("heading", { name: heading, exact: true, level: 1 }),
        ).toBeVisible();
        await capture(`09b-business-${file}`);
      }
    }
    await businessNav("2D 오피스");
    await expect(page.getByRole("heading", { name: "2D 오피스", exact: true })).toBeVisible();
    await expect(page.locator(".seller-office-stage .office-board")).toHaveCount(1);
    await expect(page.locator(".seller-sidebar")).toHaveCount(0);
    await demo("새 상담 들어옴");
    await expect(page.getByTestId("desk-consultation")).toHaveClass(/status-running/);
    await capture("09-business-consultation");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await demo("상담 끝 → 전달", false);
    await expect(page.getByTestId("desk-design")).toHaveClass(/status-running/);
    const envelope = page.locator(".office-cue-envelope");
    await expect(envelope).toBeVisible();
    const positions = await envelope.evaluate(async (element) => {
      const start = performance.now();
      const samples = [];
      await new Promise((resolve) => {
        function sample() {
          const box = element.getBoundingClientRect();
          samples.push({ time: performance.now() - start, x: box.x, y: box.y });
          if (performance.now() - start >= 350) resolve();
          else requestAnimationFrame(sample);
        }
        sample();
      });
      return samples;
    });
    const moved = positions.some(
      (sample) =>
        Math.abs(sample.x - positions[0].x) > 1 || Math.abs(sample.y - positions[0].y) > 1,
    );
    expect(moved, "The existing office envelope should physically move between teams").toBe(true);
    current.officeMotion = { moved, positions };
    await capture("10a-business-handoff-moving", "allow");
    await expect(page.getByTestId("desk-consultation")).toHaveClass(/status-completed/);
    await expect(page.getByTestId("desk-design")).toHaveClass(/status-completed/);
    await expect(page.getByTestId("run-status")).toHaveClass(/status-needs_input/);
    await expect(page.locator(".office-printout")).toHaveCount(0);
    await capture("10-business-handoff");
    await demo("클레임 발생", false);
    await expect(page.getByTestId("desk-validation")).toHaveClass(/status-running/);
    await expect(page.getByTestId("desk-quotation")).toHaveClass(/status-idle/);
    await capture("10b-business-claim-classifying");
    await expect(page.getByTestId("desk-validation")).toHaveClass(/status-completed/);
    await expect(page.locator(".office-printout")).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: "reduce" });
    current.checks.push(
      "Business navigation uses app rail and shared office; physical handoff moves the existing envelope; claims classify before completion; no fabricated quote or printer",
    );
    if (!businessOnly) {
      await page.getByRole("button", { name: "로그아웃", exact: true }).click();
      await page.getByRole("button", { name: /기업 AI 고객센터와 판매 현황을 관리해요/ }).click();
      await page.getByRole("button", { name: "상담원으로 시연", exact: true }).click();
      for (const menu of ["판매 통계", "문서 · 정책 관리", "직원 관리"]) {
        await businessNav(menu, true);
        await expect(page.locator(".seller-toast")).toContainText("관리자");
        await expect(page.locator(".app-rail .business-nav [aria-current=page]")).toContainText(
          "홈",
        );
      }
      await capture("11-business-agent-permissions");
      current.checks.push(
        "All seven administrator menus open; agent sales/documents/employees restrictions return to home with clear notice",
      );
    }
    expect(current.pageErrors).toEqual([]);
    expect(current.apiRequests).toEqual([]);
    console.log(
      `PASS ${businessOnly ? "business office" : "integrated office"} ${width}px: ${current.screenshots.length} screenshots, ${businessOnly ? "physical document transfer, claim classification" : "eight parts, revision, chat, printer, business office"}, no API calls`,
    );
    await context.close();
  }

  for (const mode of businessOnly ? [] : ["mock", "office-gallery"]) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    });
    page = await context.newPage();
    page.setDefaultTimeout(30_000);
    width = 1440;
    current = { mode, screenshots: [], pageErrors: [], apiRequests: [] };
    report.legacySmoke.push(current);
    track(page, current);
    const url = new URL(baseURL);
    url.search = mode === "mock" ? "?mock=1&pace=300" : "?office-gallery=1";
    await page.goto(url.href);
    if (mode === "mock") {
      await expect(page.locator(".office-board")).toHaveCount(1);
      await expect(page.getByTestId("chat-log")).toBeVisible();
      await expect(page.getByTestId("run-status")).toHaveClass(/status-completed/);
      await expect(page.locator(".office-printout")).toBeVisible();
    } else {
      await expect(
        page.getByRole("heading", { name: "사무실 상태 견본", exact: true }),
      ).toBeVisible();
      expect(await page.locator(".office-gallery-item .office-board").count()).toBeGreaterThan(1);
    }
    await capture(`legacy-${mode}`);
    expect(current.pageErrors).toEqual([]);
    expect(current.apiRequests).toEqual([]);
    console.log(`PASS preserved ${mode}`);
    await context.close();
  }
} catch (error) {
  report.errors.push(error.stack ?? String(error));
  if (page && !page.isClosed())
    await page
      .screenshot({
        path: fileURLToPath(new URL(`after-${width}-failure.png`, output)),
        fullPage: true,
      })
      .catch(() => undefined);
  console.error(error);
  process.exitCode = 1;
} finally {
  await writeFile(new URL(reportFile, output), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await browser.close();
}
