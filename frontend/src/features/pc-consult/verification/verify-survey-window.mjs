/* global window, document, innerWidth, innerHeight, getComputedStyle */
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import console from "node:console";

// Real local snapshot mode, with no API mocks. Every capture stays in ignored test-results.
const output = new URL("../../../../test-results/survey-window/", import.meta.url);
const base = process.env.PC_CONSULT_URL ?? "http://127.0.0.1:5174/";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const report = [],
  failures = [];
try {
  for (const [width, height] of [
    [1440, 900],
    [1024, 900],
    [1366, 768],
    [360, 900],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const result = { width, height, captures: [], checks: [], errors: [], apiRequests: [] };
    report.push(result);
    page.on("pageerror", (error) => result.errors.push(error.message));
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/"))
        result.apiRequests.push(request.url());
    });
    const dialog = page.locator(".pc-consult-window");
    function check(name, passed, data = {}) {
      result.checks.push({ name, passed, ...data });
      if (!passed) failures.push(`${width}x${height}: ${name} ${JSON.stringify(data)}`);
    }
    async function shot(name) {
      await page.mouse.move(0, 0);
      await page.screenshot({
        path: fileURLToPath(new URL(`${name}-${width}x${height}.png`, output)),
      });
      const dimensions = await page.evaluate(() => ({
        width: innerWidth,
        document: document.documentElement.scrollWidth,
        viewportHeight: innerHeight,
        documentHeight: document.documentElement.scrollHeight,
        scrollY: window.scrollY,
      }));
      check(`${name}: 가로 넘침 없음`, dimensions.document <= width, dimensions);
      result.captures.push({ name, ...dimensions });
    }
    async function login() {
      await page.goto(`${base}?pace=300`);
      await page.getByRole("button", { name: /개인 부품 교체와 새 PC/ }).click();
      await page.getByRole("button", { name: /개인용 시연으로 시작/ }).click();
      await expect(page.locator(".pc-type-screen")).toBeVisible();
    }
    async function windowGeometry(name, fieldsSelector = ".pc-form-fields") {
      const dimensions = await dialog.evaluate((element, selector) => {
        const box = (node) => {
          const rect = node?.getBoundingClientRect();
          return rect
            ? {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
                bottom: rect.bottom,
                right: rect.right,
              }
            : null;
        };
        const fields = element.querySelector(selector);
        const footer = element.querySelector(".pc-actions");
        return {
          window: box(element),
          fields: box(fields),
          footer: box(footer),
          fieldScrollHeight: fields?.scrollHeight,
          fieldClientHeight: fields?.clientHeight,
          fieldOverflow: fields ? getComputedStyle(fields).overflowY : null,
          windowOverflow: getComputedStyle(element).overflowY,
          bodyOverflow: getComputedStyle(document.body).overflowY,
          buttons: [...(footer?.querySelectorAll("button") ?? [])].map(box),
          open: element.open,
        };
      }, fieldsSelector);
      const inViewport = (rect) =>
        Boolean(
          rect &&
          rect.x >= 0 &&
          rect.y >= 0 &&
          rect.right <= width + 1 &&
          rect.bottom <= height + 1,
        );
      check(
        `${name}: 설문 창이 화면 안`,
        dimensions.open && inViewport(dimensions.window),
        dimensions,
      );
      check(
        `${name}: 하단 행동 버튼이 화면 안`,
        inViewport(dimensions.footer) && dimensions.buttons.every(inViewport),
        { footer: dimensions.footer, buttons: dimensions.buttons },
      );
      check(
        `${name}: 배경 잠금과 내부 영역 스크롤`,
        dimensions.bodyOverflow === "hidden" &&
          dimensions.windowOverflow === "hidden" &&
          ["auto", "scroll"].includes(dimensions.fieldOverflow),
        {
          body: dimensions.bodyOverflow,
          window: dimensions.windowOverflow,
          fields: dimensions.fieldOverflow,
        },
      );
      return dimensions;
    }
    async function restore() {
      await page.getByRole("button", { name: "설문 계속 작성", exact: false }).click();
      await expect(dialog).toHaveJSProperty("open", true);
    }
    try {
      await login();
      const sent = "설문 창을 열고 접어도 대화를 유지해 주세요.";
      await page.getByTestId("chat-input").fill(sent);
      await page.getByTestId("chat-send").click();
      await page.getByRole("button", { name: /신규 PC 조립/ }).click();
      await expect(dialog).toHaveJSProperty("open", true);
      const initial = await windowGeometry("신규 설문");
      await shot("new-survey");
      console.log(JSON.stringify({ stage: "survey-open", width, height, ...initial }));
      await page.locator("#pc-budget").fill("");
      await dialog.getByRole("button", { name: /입력 내용 확인/ }).click();
      await expect(page.locator("#pc-budget")).toBeFocused();
      await expect(page.locator("#pc-budget-error")).toBeVisible();
      check("필수 값 미입력 시 예산으로 포커스 이동", true);
      await page.locator("#pc-budget").fill("3000000");
      await page.getByRole("checkbox", { name: /고사양 게임/ }).check();
      await page.getByLabel("목표 해상도").selectOption("qhd");
      await page.getByLabel("목표 프레임").selectOption("144");
      const fields = dialog.locator(".pc-form-fields");
      const beforeScroll = await page.evaluate(() => window.scrollY);
      await fields.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await windowGeometry("입력 영역 끝");
      check(
        "설문 필드만 스크롤",
        (await fields.evaluate((element) => element.scrollTop)) > 0 &&
          (await page.evaluate(() => window.scrollY)) === beforeScroll,
      );
      await shot("new-survey-bottom");
      const normal = await dialog.boundingBox();
      await dialog.getByRole("button", { name: "크게 보기", exact: true }).click();
      await expect(dialog).toHaveAttribute("data-expanded", "true");
      await windowGeometry("큰 설문 창");
      const expanded = await dialog.boundingBox();
      check(
        "크게 보기 크기와 상태",
        Boolean(
          normal && expanded && expanded.width >= normal.width && expanded.height >= normal.height,
        ),
        { normal, expanded },
      );
      await shot("new-survey-expanded");
      await dialog.getByRole("button", { name: "기본 크기", exact: true }).click();
      await expect(dialog).toHaveAttribute("data-expanded", "false");
      await dialog.getByRole("button", { name: "설문 창 접기", exact: true }).click();
      await expect(dialog).toHaveJSProperty("open", false);
      await expect(page.getByRole("button", { name: /설문 계속 작성/ })).toBeFocused();
      check(
        "접기 뒤 배경 스크롤 잠금 해제",
        await page.evaluate(() => getComputedStyle(document.body).overflowY !== "hidden"),
      );
      await shot("new-survey-folded");
      await restore();
      await expect(page.locator("#pc-budget")).toHaveValue("3,000,000");
      await expect(page.getByRole("checkbox", { name: /고사양 게임/ })).toBeChecked();
      await expect(page.getByLabel("목표 해상도")).toHaveValue("qhd");
      await expect(page.getByLabel("목표 프레임")).toHaveValue("144");
      check("접기·복원 뒤 예산·용도·성능 초안 유지", true);
      const escapedFocus = [];
      for (let index = 0; index < 28; index++) {
        await page.keyboard.press("Tab");
        if (!(await dialog.evaluate((element) => element.contains(document.activeElement))))
          escapedFocus.push(
            await page.evaluate(() => ({
              tag: document.activeElement?.tagName,
              id: document.activeElement?.id,
              text: document.activeElement?.getAttribute("aria-label"),
            })),
          );
      }
      for (let index = 0; index < 28; index++) {
        await page.keyboard.press("Shift+Tab");
        if (!(await dialog.evaluate((element) => element.contains(document.activeElement))))
          escapedFocus.push(
            await page.evaluate(() => ({
              direction: "backward",
              tag: document.activeElement?.tagName,
              id: document.activeElement?.id,
              text: document.activeElement?.getAttribute("aria-label"),
            })),
          );
      }
      check("키보드 Tab 포커스가 창 안에 유지", escapedFocus.length === 0, { escapedFocus });
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveJSProperty("open", false);
      await expect(page.getByRole("button", { name: /설문 계속 작성/ })).toBeFocused();
      await restore();
      check("Escape 접기와 복원 버튼 포커스", true);
      await dialog.getByRole("button", { name: /입력 내용 확인/ }).click();
      await expect(dialog.locator(".pc-review")).toContainText("₩3,000,000");
      await windowGeometry("설문 확인", ".pc-review-body");
      await shot("review");
      await dialog.getByRole("button", { name: "입력 내용 고치기", exact: true }).click();
      await expect(page.locator("#pc-budget")).toHaveValue("3,000,000");
      await expect(page.getByRole("checkbox", { name: /고사양 게임/ })).toBeChecked();
      check("확인 화면에서 고치기로 돌아가도 값 유지", true);
      await dialog.getByRole("button", { name: /입력 내용 확인/ }).click();
      await dialog.getByRole("button", { name: /상담 시작/ }).click();
      await expect(page.locator(".pc-recommended")).toBeVisible({ timeout: 60000 });
      await expect(dialog).toHaveCount(0);
      await expect(page.locator(".office-board")).toBeVisible();
      await expect(page.getByTestId("chat-user").filter({ hasText: sent })).toHaveCount(1);
      check(
        "후보 화면에서 창 닫힘·배경 잠금 해제·대화 유지",
        await page.evaluate(() => getComputedStyle(document.body).overflowY !== "hidden"),
      );
      await page.evaluate(() => window.scrollTo(0, 0));
      await shot("candidates");

      await login();
      await page.getByRole("button", { name: /기존 PC 부품 교체/ }).click();
      await expect(dialog).toHaveJSProperty("open", true);
      await page.locator("#pc-budget").fill("750000");
      await page.getByRole("checkbox", { name: /고사양 게임/ }).check();
      const owned = dialog.locator(".pc-owned").first();
      const firstSummary = owned.locator("summary");
      const secondSummary = dialog.locator(".pc-owned").nth(1).locator("summary");
      await expect(owned).toHaveJSProperty("open", false);
      await firstSummary.focus();
      await page.keyboard.press("Tab");
      await expect(secondSummary).toBeFocused();
      check("닫힌 보유 부품 제목에서 Tab으로 다음 부품 이동", true);
      await page.keyboard.press("Shift+Tab");
      await expect(firstSummary).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(owned).toHaveJSProperty("open", true);
      await page.keyboard.press("Tab");
      await expect(page.locator("#pc-search-cpu")).toBeFocused();
      check("펼친 보유 부품 제목에서 Tab으로 제품 검색 이동", true);
      await page.locator("#pc-search-cpu").fill("검증용 목록에 없는 부품");
      await expect(
        owned.getByText("검색 결과가 없습니다. 아래에서 직접 입력해 주세요."),
      ).toBeVisible();
      await page.locator("#pc-manual-cpu").fill("직접 입력할 CPU 메모");
      const ownedScroll = await dialog
        .locator(".pc-form-fields")
        .evaluate((element) => element.scrollTop);
      await windowGeometry("보유 부품 펼침");
      await shot("replacement-owned");
      await dialog.getByRole("button", { name: "설문 창 접기", exact: true }).click();
      await expect(dialog).toHaveJSProperty("open", false);
      await restore();
      await expect(owned).toHaveJSProperty("open", true);
      await expect(page.locator("#pc-search-cpu")).toHaveValue("검증용 목록에 없는 부품");
      await expect(page.locator("#pc-manual-cpu")).toHaveValue("직접 입력할 CPU 메모");
      await expect(page.locator("#pc-budget")).toHaveValue("750,000");
      await expect(page.getByRole("checkbox", { name: /고사양 게임/ })).toBeChecked();
      check("보유 부품 검색·직접 입력·펼침 상태 보존", true, {
        ownedScroll,
        restoredScroll: await dialog
          .locator(".pc-form-fields")
          .evaluate((element) => element.scrollTop),
      });
      await owned.getByRole("button", { name: "추가", exact: true }).click();
      await expect(owned.locator("summary")).toContainText("직접 입력할 CPU 메모");
      await expect(owned.locator("summary")).toContainText("미확인");
      await page.getByRole("checkbox", { name: "게임이 끊겨요", exact: true }).check();
      await page.locator("#pc-problem-note").fill("접었다 이어 쓰는 교체 상담 메모입니다.");
      await dialog.locator(".pc-form-fields").evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      await windowGeometry("긴 교체 설문 끝");
      await shot("replacement-bottom");
      await page.keyboard.press("Escape");
      await restore();
      await expect(page.locator("#pc-problem-note")).toHaveValue(
        "접었다 이어 쓰는 교체 상담 메모입니다.",
      );
      await dialog.getByRole("button", { name: /입력 내용 확인/ }).click();
      await expect(dialog.locator(".pc-review")).toContainText("직접 입력할 CPU 메모");
      await shot("replacement-review");
      check("교체 상담 미확인 부품·자유 입력 메모 유지", true);
      check("페이지 오류 없음", result.errors.length === 0, { errors: result.errors });
      check("백엔드 호출 없음", result.apiRequests.length === 0, {
        apiRequests: result.apiRequests,
      });
    } catch (error) {
      failures.push(`${width}x${height}: ${error.message}`);
      result.flowError = error.message;
      await shot("failure");
    } finally {
      await page.close();
      await writeFile(
        new URL("report.json", output),
        JSON.stringify({ report, failures }, null, 2),
      );
    }
  }
} finally {
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
expect(failures, "Survey window layout and state preservation").toEqual([]);
