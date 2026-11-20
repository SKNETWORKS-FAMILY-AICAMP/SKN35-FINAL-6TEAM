/* global document, innerWidth, innerHeight, getComputedStyle, localStorage, sessionStorage */
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import console from "node:console";

// The single-screen login intentionally replaces the older two-screen entry.
// Old scripts and their screenshots remain intact. This uses real local snapshots.
const preview = process.env.UI_REFRESH_PREVIEW === "1";
const output = new URL(
  `../../../../test-results/ui-refresh/${preview ? "preview" : "final"}/`,
  import.meta.url,
);
const base = process.env.PC_CONSULT_URL ?? "http://127.0.0.1:5174/";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const report = [],
  failures = [];
const sizes = [
  [1440, 900],
  [1024, 900],
  [360, 900],
  [1366, 768],
];
try {
  for (const [width, height] of sizes) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
    page.setDefaultTimeout(20000);
    const result = { width, height, captures: [], checks: [], errors: [], apiRequests: [] };
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
    async function capture(name, fullPage = true) {
      await page.mouse.move(0, 0);
      await page.screenshot({
        path: fileURLToPath(new URL(`${name}-${width}x${height}.png`, output)),
        fullPage,
      });
      const dimensions = await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        contentWidth: document.documentElement.scrollWidth,
        contentHeight: document.documentElement.scrollHeight,
      }));
      check(`${name}: 가로 넘침 없음`, dimensions.contentWidth <= width, dimensions);
      result.captures.push(name);
    }
    async function entry() {
      await page.goto(`${base}?pace=300`);
      await expect(page.getByRole("form", { name: "기업용 로그인", exact: true })).toBeVisible();
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
    try {
      await entry();
      await expect(page.locator("form")).toHaveCount(1);
      await expect(page.locator(".app-rail")).toHaveCount(0);
      check("첫 화면에 로그인 폼 하나, 업무 메뉴 없음", true);
      await capture("login-business");
      await capture("login-business-viewport", false);
      const submitBox = await page
        .getByRole("button", { name: "로그인", exact: true })
        .boundingBox();
      check("로그인 버튼이 첫 화면 안", !!submitBox && submitBox.y + submitBox.height <= height, {
        submitBox,
      });
      if (!preview) {
        await page.getByRole("button", { name: "로그인", exact: true }).click();
        await expect(page.getByRole("alert")).toContainText("아이디와 비밀번호");
        await expect(page.getByLabel("아이디", { exact: true })).toBeFocused();
        check("빈 로그인은 입력 안내와 포커스로 복구", true);
      }
      await page.getByLabel("아이디", { exact: true }).fill("시연계정");
      await page.locator("#pc-password").fill("ui-refresh-demo-only");
      await page.getByRole("button", { name: "개인용", exact: true }).click();
      await expect(page.getByRole("form", { name: "개인용 로그인", exact: true })).toBeVisible();
      await expect(page.locator("form")).toHaveCount(1);
      await expect(page.locator("#pc-password")).toHaveValue("");
      check("기업·개인 전환은 같은 폼, 비밀번호 초기화", true);
      await capture("login-personal");
      await page.getByRole("button", { name: "기업용", exact: true }).click();
      if (!preview) {
        await page.getByRole("button", { name: "회원가입", exact: true }).click();
        await page.getByLabel("아이디", { exact: true }).fill("가입시연");
        await page.locator("#pc-password").fill("ui-refresh-demo-only");
        await page.getByLabel("기업 인증번호", { exact: true }).fill("INVALID");
        await page.getByRole("button", { name: "회원가입", exact: true }).click();
        await expect(page.getByRole("alert")).toContainText("등록되지 않은 기업 인증번호");
        check("잘못된 기업 인증번호 거부", true);
        await capture("signup-error");
        await page.getByLabel("기업 인증번호", { exact: true }).fill("BW-2002");
        await page.getByRole("button", { name: "회원가입", exact: true }).click();
        await expect(page.getByRole("combobox", { name: "시연 기업" })).toHaveValue("BW-2002");
        await expect(page.locator("#pc-password")).toHaveValue("");
        check("시연 가입 후 기업 유지·비밀번호 삭제", true);
      }
      await page.getByRole("combobox", { name: "시연 기업" }).selectOption("BW-1001");
      await page.getByRole("button", { name: "관리자로 시연", exact: true }).click();
      await expect(page.locator(".management-home")).toBeVisible();
      await expect(page.locator(".management-company-strip")).not.toContainText("집계 중", {
        timeout: 60000,
      });
      await expect(page.locator(".entry-shell")).toHaveCount(0);
      check("로그인 한 번으로 기업 홈 진입", true);
      await capture("business-home");
      await capture("business-home-viewport", false);
      if (!preview && width !== 1366) {
        const menus = [
          ["상담 · 이슈", "handoff"],
          ["고객 정보", "customers"],
          ["판매 통계", "sales"],
          ["고객 피드백", "feedback"],
          ["상품 · 정책", "catalog"],
          ["AI 직원 · 사람 직원", "teams"],
          ["고객 화면 미리보기", "preview"],
        ];
        for (const [label, file] of menus) {
          await menu(label);
          await capture(file);
        }
        await menu("상품 · 정책");
        await page.getByRole("button", { name: "판매 정책", exact: true }).click();
        await capture("policies");
        // Explicit UI setup for approval scenarios. 1024 keeps the default human-review policy.
        // No source policy, snapshot, or compatibility result is changed by this test.
        if (width !== 1024) {
          await expect(
            page.getByRole("checkbox", { name: "호환성 확인 불가 항목이 있을 때" }),
          ).toBeChecked();
          await page.getByRole("checkbox", { name: "호환성 확인 불가 항목이 있을 때" }).uncheck();
          await page
            .getByRole("checkbox", { name: "BIOS 등 조건부 지원을 확인해야 할 때" })
            .uncheck();
          await page
            .getByRole("spinbutton", { name: "자동 견적 검토 한도", exact: true })
            .fill("5000000");
          await page.getByRole("button", { name: "정책 저장", exact: true }).click();
          check("시연 승인 시나리오의 정책을 관리자 화면에서 명시적으로 설정", true);
        }
        await page.getByRole("button", { name: "문서 · 응대 자료", exact: true }).click();
        await capture("documents");
        await page.getByRole("button", { name: "시연 제어 열기", exact: true }).click();
        await expect(page.getByRole("complementary", { name: "시연 제어" })).toBeVisible();
        await capture("demo-controls");
        check("기업 메뉴와 정책·문서·시연 제어 유지", true);
      }
      await page
        .locator(".shell-account")
        .getByRole("button", { name: "로그아웃", exact: true })
        .click();
      await expect(page.getByRole("form", { name: "기업용 로그인", exact: true })).toBeVisible();
      check("로그아웃은 중간 선택 없이 로그인으로", true);
      if (!preview) {
        await page.getByRole("button", { name: "상담원으로 시연", exact: true }).click();
        await expect(page.locator(".shell-account")).toContainText("상담원");
        check(
          "상담원 제한 메뉴 유지",
          (await page.locator('.business-nav button[aria-label$="관리자 전용"]').count()) > 0,
        );
        await page.locator(".shell-account").getByRole("button", { name: "로그아웃" }).click();
      }
      await page.getByRole("button", { name: "개인용", exact: true }).click();
      if (preview) await page.getByRole("button", { name: /개인용 시연으로 시작/ }).click();
      else {
        await page.getByLabel("아이디", { exact: true }).fill("개인시연");
        await page.locator("#pc-password").fill("ui-refresh-demo-only");
        await page.getByRole("button", { name: "비밀번호 보기", exact: true }).click();
        await expect(page.locator("#pc-password")).toHaveAttribute("type", "text");
        await page.getByRole("button", { name: "비밀번호 숨기기", exact: true }).click();
        await expect(page.locator("#pc-password")).toHaveAttribute("type", "password");
        await page.locator("#pc-password").press("Enter");
      }
      await expect(page.locator(".pc-type-screen")).toBeVisible();
      await expect(page.locator(".bw-entry")).toHaveCount(0);
      check("개인 진입 뒤 두 번째 로그인 없음", true);
      await capture("personal-workspace");
      await page.getByRole("button", { name: /신규 PC 조립/ }).click();
      const dialog = page.locator(".pc-consult-window");
      await expect(dialog).toHaveJSProperty("open", true);
      await page.locator("#pc-budget").fill("5000000");
      await page.getByRole("checkbox", { name: /고사양 게임/ }).check();
      await capture("survey", false);
      const geometry = await dialog.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const footer = element.querySelector(".pc-actions")?.getBoundingClientRect();
        return {
          right: box.right,
          bottom: box.bottom,
          footerBottom: footer?.bottom,
          bodyOverflow: getComputedStyle(document.body).overflowY,
        };
      });
      check(
        "설문 내부 스크롤과 하단 버튼 유지",
        geometry.right <= width + 1 &&
          geometry.bottom <= height + 1 &&
          geometry.footerBottom <= height + 1 &&
          geometry.bodyOverflow === "hidden",
        geometry,
      );
      if (preview || width === 1366) continue;
      await page.getByRole("button", { name: /입력 내용 확인/ }).click();
      await capture("review", false);
      await page.getByRole("button", { name: "상담 시작", exact: true }).click();
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
        await expect(
          page.getByRole("heading", { name: `${category} 후보를 골라 주세요.`, exact: true }),
        ).toBeVisible({ timeout: 60000 });
        await expect(page.locator(".pc-selection")).toHaveAttribute("aria-busy", "false", {
          timeout: 60000,
        });
        if (category === "CPU") await capture("candidates");
        const passed = page.locator(".pc-candidate-list > article");
        if (await passed.count()) await passed.first().getByRole("button").click();
        else {
          const unknown = page.getByTestId("pc-unknown");
          if ((await unknown.getAttribute("open")) === null)
            await unknown.locator("summary").click();
          if (category === "저장장치") await capture("unknown-candidates");
          await unknown.getByTestId("pc-candidate").first().getByRole("button").click();
          await page.getByRole("button", { name: "주의사항을 확인하고 선택", exact: true }).click();
        }
      }
      await expect(page.locator(".pc-quote-table tbody tr")).toHaveCount(8, { timeout: 60000 });
      await capture("quote");
      check(
        "8단계 구성과 이미지 포함 견적 유지",
        (await page.locator(".pc-quote-table .pc-hardware-art").count()) === 8,
      );
      if (width === 1024) {
        await expect(
          page.getByRole("button", { name: "이 견적으로 확정", exact: true }),
        ).toBeDisabled();
        await expect(page.locator("#pc-quote-handoff")).toBeVisible();
        check("기본 기업 정책은 확인 불가 견적을 사람에게 넘기고 승인 차단", true);
        await capture("quote-handoff");
        continue;
      }
      await page.getByRole("button", { name: "이 견적으로 확정", exact: true }).click();
      await capture("confirm", false);
      await page.getByRole("button", { name: "확인하고 시연 저장", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "선택하신 견적을 저장했어요.", exact: true }),
      ).toBeVisible();
      await capture("saved");
      check("견적 승인과 메모리 저장 완료", true);
      const storedSecret = await page.evaluate(() =>
        [...Object.values(localStorage), ...Object.values(sessionStorage)].some((value) =>
          value.includes("ui-refresh-demo-only"),
        ),
      );
      check("비밀번호 저장 없음", !storedSecret);
    } catch (error) {
      failures.push(`${width}x${height}: ${error.message}`);
      result.flowError = error.message;
      await capture("failure");
    } finally {
      check("브라우저 오류 없음", result.errors.length === 0, { errors: result.errors });
      check("백엔드 호출 없음", result.apiRequests.length === 0, {
        apiRequests: result.apiRequests,
      });
      await page.close();
      await writeFile(
        new URL("report.json", output),
        JSON.stringify({ preview, report, failures }, null, 2),
      );
    }
    console.log(
      JSON.stringify({
        width,
        passed: result.checks.filter((check) => check.passed).length,
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
expect(failures, "Single login and refreshed workspace flows").toEqual([]);
