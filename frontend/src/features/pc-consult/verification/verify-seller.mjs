/** Explicitly synthetic seller UI verification. No real authentication, customers, sales,
 * document files, backend, payment, or persistent storage are used.
 * From frontend with the repository Playwright browser cache configured:
 * node src/features/pc-consult/verification/verify-seller.mjs
 */
/* global document, localStorage, sessionStorage, requestAnimationFrame, performance */
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import console from "node:console";
import process from "node:process";

const baseURL = process.env.PC_CONSULT_URL ?? "http://127.0.0.1:5173/?pc-consult=1";
const output = new URL("./screenshots/seller/", import.meta.url);
const report = { checkedAt: new Date().toISOString(), baseURL, viewports: [], errors: [] };
const browser = await chromium.launch({ headless: true });
let page;
let width;
let current;

async function capture(name) {
  await page.evaluate(() => document.fonts.ready);
  const bounds = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
    outside: [...document.querySelectorAll(".seller-app *")]
      .filter(
        (element) =>
          element.getBoundingClientRect().right > document.documentElement.clientWidth + 1,
      )
      .slice(0, 8)
      .map((element) => element.className),
  }));
  expect(bounds.scroll, `${name} overflow: ${JSON.stringify(bounds)}`).toBeLessThanOrEqual(
    bounds.viewport + 1,
  );
  await page.screenshot({
    path: fileURLToPath(new URL(`${width}/${name}.png`, output)),
    fullPage: true,
    animations: "disabled",
  });
  current.screenshots.push(`${width}/${name}.png`);
}
async function nav(name, locked = false) {
  const target = page.locator(".seller-sidebar").getByRole("button", {
    name: locked ? `${name} · 관리자 전용` : name,
    exact: true,
    includeHidden: true,
  });
  if (!(await target.isVisible()))
    await page.getByRole("button", { name: "메뉴 열기", exact: true }).click();
  await target.click();
  if (!locked) await expect(target).toHaveClass(/seller-active/);
}
async function panel() {
  const button = page.locator(".seller-demo-toggle");
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
  return page.getByRole("complementary", { name: "시연 제어", exact: true });
}
async function demo(label, wait = true) {
  const controls = await panel();
  await controls.getByRole("button", { name: label, exact: true }).click();
  if (wait && label !== "처음으로")
    await expect(
      controls.getByRole("button", { name: "전체 시나리오 자동 재생", exact: true }),
    ).toBeEnabled({ timeout: 35_000 });
}
async function closePanel() {
  if ((await page.locator(".seller-demo-toggle").getAttribute("aria-expanded")) === "true")
    await page.locator(".seller-demo-toggle").click();
}
async function metric(title) {
  return page
    .locator(".seller-metric")
    .filter({ hasText: title })
    .locator(":scope > strong")
    .innerText();
}
async function openBusiness() {
  await page.goto(baseURL);
  await page.getByRole("button", { name: /기업 AI 고객센터와 판매 현황을 관리해요/ }).click();
}
async function storageIsEmpty() {
  expect(
    await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length })),
  ).toEqual({ local: 0, session: 0 });
}

try {
  for (width of [1440, 360]) {
    await mkdir(new URL(`${width}/`, output), { recursive: true });
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    page = await context.newPage();
    page.setDefaultTimeout(15_000);
    current = {
      width,
      screenshots: [],
      checks: [],
      pageErrors: [],
      apiRequests: [],
      officeMotion: null,
    };
    report.viewports.push(current);
    page.on("pageerror", (error) => current.pageErrors.push(error.message));
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith("/api/") || request.method() !== "GET")
        current.apiRequests.push(`${request.method()} ${url.pathname}`);
    });
    await openBusiness();
    await page.getByRole("button", { name: "회원가입", exact: true }).click();
    await page.getByLabel("아이디", { exact: true }).fill("시연가입확인");
    await page.getByLabel("비밀번호", { exact: true }).fill("demo-only-value");
    await page.locator('[name="companyCode"]').fill("BW-NOT-REGISTERED");
    await page.getByRole("button", { name: "회원가입", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText("등록되지 않은 기업 인증번호입니다");
    await capture("01-company-signup-invalid-code");
    await page.locator('[name="companyCode"]').fill("BW-2002");
    await page.getByRole("button", { name: "회원가입", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("시연 회원가입이 완료되었습니다.");
    await expect(page.getByLabel("시연 기업", { exact: true })).toHaveValue("BW-2002");
    await page.getByRole("button", { name: "관리자로 시연", exact: true }).click();
    await expect(page.locator(".seller-company-card strong")).toHaveText("테스트컴퓨터");
    await expect(page.locator(".seller-metric")).toHaveCount(4);
    const initialConsultations = await metric("오늘의 상담");
    const initialSales = await metric("오늘 판매 건수");
    await capture("02-admin-home");
    current.checks.push(
      "Incorrect enterprise code rejected; BW-2002 mapped to correct company; four metrics",
    );

    await nav("고객 정보");
    await expect(page.locator(".seller-table tbody tr")).toHaveCount(20);
    await capture("03-customers");
    await page.getByRole("button", { name: "학생", exact: true }).click();
    await expect(page.locator(".seller-table tbody tr")).toHaveCount(5);
    await page.getByRole("button", { name: "전체", exact: true }).click();
    await page.getByLabel("고객 검색", { exact: true }).fill("시연 고객 01");
    await expect(page.locator(".seller-table tbody tr")).toHaveCount(1);
    await page.getByLabel("고객 검색", { exact: true }).fill("");
    await page.getByRole("button", { name: "시연 고객 01 상세 보기", exact: true }).click();
    const customerDialog = page.getByRole("dialog", {
      name: "시연 고객 01 고객 정보",
      exact: true,
    });
    await expect(customerDialog).toBeVisible();
    await customerDialog.locator(".seller-detail-list button").first().click();
    const quoteDialog = page.getByRole("dialog", { name: "견적 상세", exact: true });
    await expect(quoteDialog.locator(".seller-quote-items li")).toHaveCount(2);
    await capture("04-customer-quote-preview");
    await quoteDialog.getByRole("button", { name: "창 닫기", exact: true }).click();
    await customerDialog.getByRole("button", { name: "상담 내역", exact: true }).click();
    await customerDialog.locator(".seller-chat-session summary").first().click();
    await expect(
      customerDialog.locator(".seller-chat-session").first().locator(".seller-chat"),
    ).toHaveCount(3);
    await capture("05-customer-chat-history");
    await customerDialog.getByRole("button", { name: "상담 요약", exact: true }).click();
    await expect(customerDialog.getByText("고객 요청", { exact: true })).toBeVisible();
    await capture("06-customer-summary-drawer");
    await customerDialog.getByRole("button", { name: "고객 차단", exact: true }).click();
    const blockDialog = page.getByRole("dialog", { name: "차단 사유를 알려주세요.", exact: true });
    await blockDialog.getByLabel("차단 사유", { exact: true }).fill("시연: 상담 진행 방해 확인");
    await blockDialog.getByRole("button", { name: "사유를 남기고 차단", exact: true }).click();
    await expect(
      customerDialog.getByText("현재 차단된 고객입니다.", { exact: true }),
    ).toBeVisible();
    await customerDialog.getByRole("button", { name: "창 닫기", exact: true }).click();
    await page.getByRole("button", { name: /악성 사용자 관리/ }).click();
    await expect(page.locator(".seller-table tbody tr")).toHaveCount(3);
    await page
      .locator(".seller-table tbody tr")
      .filter({ hasText: "시연 고객 01" })
      .getByRole("button", { name: "차단 해제", exact: true })
      .click();
    await expect(page.locator(".seller-table tbody tr")).toHaveCount(2);
    current.checks.push(
      "Customer search/type filter, quote preview, collapsible chat, summary, reasoned block and unblock",
    );

    await nav("직원 관리");
    const pendingEmployee = page.locator(".seller-table tbody tr").filter({ hasText: "가상신청D" });
    await pendingEmployee.getByRole("button", { name: "가입 승인", exact: true }).click();
    await expect(pendingEmployee.getByLabel("가상신청D 권한", { exact: true })).toBeEnabled();
    await pendingEmployee.getByLabel("가상신청D 권한", { exact: true }).selectOption("admin");
    await pendingEmployee.getByRole("button", { name: "비활성화", exact: true }).click();
    await expect(pendingEmployee).toContainText("비활성");
    await capture("07-employees");
    current.checks.push("Employee approval, role change, deactivation");

    await nav("문서 · 정책 관리");
    const documentCount = await page.locator(".seller-documents li").count();
    await page.getByRole("button", { name: "문서 올리기", exact: true }).click();
    await page.getByRole("button", { name: "선택한 문서로 시연 업로드", exact: true }).click();
    await expect(page.getByRole("progressbar")).toBeVisible();
    await expect(page.locator(".seller-documents li")).toHaveCount(documentCount + 1);
    await expect(page.getByRole("progressbar")).toHaveCount(0);
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
    await page.getByLabel("기본 배송비", { exact: true }).fill("4000");
    await page.getByLabel("기본 할인율", { exact: true }).fill("7");
    await page.getByRole("button", { name: "정책 저장 · 시연", exact: true }).click();
    await expect(page.locator(".seller-toast")).toContainText("견적에 반영되었습니다");
    await capture("08-documents-policies");
    current.checks.push(
      "Synthetic document picker, actual delayed progress, no real file input, policy save",
    );

    await nav("판매 통계");
    await page.getByRole("button", { name: "주간", exact: true }).click();
    await expect(page.getByRole("button", { name: "주간", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByRole("button", { name: "월간", exact: true }).click();
    await page.getByRole("button", { name: "일간", exact: true }).click();
    await capture("09-sales-statistics");
    await demo("새 상담 들어옴");
    expect(await page.locator(".seller-unread").count()).toBeGreaterThan(0);
    await nav("홈");
    expect(await metric("오늘의 상담")).not.toBe(initialConsultations);
    await nav("2D 오피스");
    const paper = page.getByRole("button", { name: "현재 전달 서류 상세 보기", exact: true });
    await expect(paper).toBeVisible();
    const before = await paper.boundingBox();
    await demo("상담 끝 → 전달", false);
    await expect(page.locator(".seller-visual-paper--handoff")).toBeVisible();
    const positions = await page
      .locator(".seller-visual-paper--handoff")
      .evaluate(async (element) => {
        const start = performance.now();
        const samples = [];
        await new Promise((resolve) => {
          function sample() {
            const box = element.getBoundingClientRect();
            samples.push({ time: performance.now() - start, x: box.x, y: box.y });
            if (performance.now() - start > 350) resolve();
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
    expect(moved, "Document should physically move during handoff").toBe(true);
    await expect(page.locator(".seller-visual-office-status")).toContainText("요약 완료");
    await expect(
      (await panel()).getByRole("button", { name: "전체 시나리오 자동 재생", exact: true }),
    ).toBeEnabled();
    const after = await paper.boundingBox();
    current.officeMotion = { before, after, samples: positions.length, moved };
    await closePanel();
    await paper.click();
    await expect(page.getByRole("button", { name: /처리함에서 보기/ })).toBeVisible();
    await expect(
      page.locator(".seller-visual-office").getByRole("button", { name: "처리 완료", exact: true }),
    ).toHaveCount(0);
    await capture("10-office-handoff");
    await page.getByRole("button", { name: /처리함에서 보기/ }).click();
    await expect(page.locator(".seller-kanban-column")).toHaveCount(4);
    await demo("클레임 발생", false);
    await expect(page.locator(".seller-stage-received")).toContainText(
      "시연 주문의 배송 일정 확인 요청",
    );
    await expect(page.locator(".seller-stage-classified")).toContainText(
      "시연 주문의 배송 일정 확인 요청",
    );
    await expect(
      (await panel()).getByRole("button", { name: "전체 시나리오 자동 재생", exact: true }),
    ).toBeEnabled();
    await closePanel();
    await page
      .locator(".seller-stage-classified .seller-issue-card")
      .filter({ hasText: "시연 주문의 배송 일정 확인 요청" })
      .click();
    const issueDialog = page.getByRole("dialog", { name: "이슈 상세", exact: true });
    await issueDialog
      .getByLabel("담당자 선택", { exact: true })
      .selectOption({ label: "가상상담A" });
    await issueDialog.getByRole("button", { name: "담당자 지정", exact: true }).click();
    await expect(issueDialog.getByRole("button", { name: "처리 완료", exact: true })).toBeEnabled();
    await issueDialog.getByRole("button", { name: "처리 완료", exact: true }).click();
    await expect(issueDialog.getByText("처리가 완료된 이슈입니다.", { exact: true })).toBeVisible();
    await issueDialog.getByRole("button", { name: "창 닫기", exact: true }).click();
    await capture("11-issues-kanban");
    current.checks.push(
      "Global unread indicator, consultation counter update, physical office handoff animation, received-to-classified delay, assignment and completion",
    );

    await demo("욕설 감지");
    await nav("고객 정보");
    await page.getByRole("button", { name: /악성 사용자 관리/ }).click();
    await expect(page.locator(".seller-abuse-alert")).toHaveCount(1);
    await expect(page.locator(".seller-abuse-alert")).toContainText("***");
    await closePanel();
    await capture("12-abuse-management");
    await page
      .locator(".seller-abuse-alert")
      .getByRole("button", { name: "무시", exact: true })
      .click();
    await expect(page.locator(".seller-abuse-alert")).toHaveCount(0);
    await demo("판매 발생");
    await nav("홈");
    expect(await metric("오늘 판매 건수")).not.toBe(initialSales);
    await demo("전체 시나리오 자동 재생", false);
    await expect(page.locator(".seller-demo-controls")).toContainText("전체 시나리오 재생 중");
    await demo("처음으로", false);
    await expect(page.locator(".seller-metric")).toHaveCount(4);
    await expect.poll(() => metric("오늘의 상담")).toBe(initialConsultations);
    await demo("전체 시나리오 자동 재생", false);
    const autoStarted = Date.now();
    await nav("2D 오피스");
    await expect(page.locator(".seller-visual-office-status")).toContainText("분류 완료", {
      timeout: 20_000,
    });
    await expect(
      (await panel()).getByRole("button", { name: "전체 시나리오 자동 재생", exact: true }),
    ).toBeEnabled({ timeout: 20_000 });
    current.autoScenarioElapsedMs = Date.now() - autoStarted;
    expect(current.autoScenarioElapsedMs).toBeGreaterThanOrEqual(28_000);
    await nav("홈");
    expect(await metric("오늘의 상담")).not.toBe(initialConsultations);
    expect(await metric("오늘 판매 건수")).not.toBe(initialSales);
    await closePanel();
    await capture("13-global-scenario-complete");
    current.checks.push(
      "All seven demo buttons, sale counter, cancel/reset, full approximately 30-second auto scenario across menus",
    );
    await storageIsEmpty();

    await page.getByRole("button", { name: "로그아웃", exact: true }).click();
    await page.getByRole("button", { name: /기업 AI 고객센터와 판매 현황을 관리해요/ }).click();
    await page.getByRole("button", { name: "상담원으로 시연", exact: true }).click();
    for (const restricted of ["판매 통계", "문서 · 정책 관리", "직원 관리"]) {
      await nav(restricted, true);
      await expect(page.locator(".seller-nav-item.seller-active")).toContainText("홈");
      await expect(page.locator(".seller-toast")).toContainText("관리자");
    }
    await demo("욕설 감지");
    await nav("고객 정보");
    await page.getByRole("button", { name: /악성 사용자 관리/ }).click();
    await page
      .locator(".seller-abuse-alert")
      .getByRole("button", { name: "차단 요청", exact: true })
      .click();
    await expect(page.locator(".seller-toast")).toContainText("관리자에게");
    await expect(page.getByRole("button", { name: "차단 해제", exact: true })).toHaveCount(0);
    await closePanel();
    await capture("14-agent-permissions");
    current.checks.push(
      "Staff restricted menus stay locked, customer block request only, no unblock control",
    );
    await storageIsEmpty();
    expect(current.pageErrors).toEqual([]);
    expect(current.apiRequests).toEqual([]);
    console.log(
      `PASS seller ${width}px: ${current.screenshots.length} screenshots; ${current.checks.length} feature groups`,
    );
    await context.close();
  }
} catch (error) {
  report.errors.push(error.stack ?? String(error));
  if (page && !page.isClosed())
    await page
      .screenshot({ path: fileURLToPath(new URL(`${width}/failure.png`, output)), fullPage: true })
      .catch(() => undefined);
  console.error(error);
  process.exitCode = 1;
} finally {
  await writeFile(
    new URL("./seller-report.json", import.meta.url),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
  await browser.close();
}
