/* global document, innerWidth, innerHeight, getComputedStyle, localStorage, sessionStorage */
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";
import process from "node:process";
import console from "node:console";

const phase = process.env.ENTRY_PHASE === "before" ? "before" : "after";
const preview = process.env.ENTRY_PREVIEW === "1";
const output = new URL(
  `../../../../test-results/entry-experience/${preview ? "preview" : phase}/`,
  import.meta.url,
);
const base = process.env.PC_CONSULT_URL ?? "http://127.0.0.1:5174/";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const report = [];
const failures = [];
const viewports = preview
  ? [
      [1440, 900],
      [1024, 900],
    ]
  : phase === "before"
    ? [
        [1440, 900],
        [360, 900],
      ]
    : [
        [1440, 900],
        [1024, 900],
        [1366, 768],
        [360, 900],
      ];
const teamLabels = ["상담팀", "설계·분석팀", "검증팀", "견적·주문팀"];

// Real local UI and snapshot source. Existing verification scripts remain unchanged.
try {
  for (const [width, height] of viewports) {
    const page = await browser.newPage({ viewport: { width, height } });
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
      const layout = await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        contentWidth: document.documentElement.scrollWidth,
        contentHeight: document.documentElement.scrollHeight,
      }));
      check(`${name}: 가로 넘침 없음`, layout.contentWidth <= width, layout);
      result.captures.push({ name, ...layout });
    }
    async function welcome() {
      await page.goto(base);
      await expect(page.locator(".pc-entry-choices")).toBeVisible();
      await page.locator(".bw-entry").evaluate(async (element) => {
        const arrivals = element
          .getAnimations({ subtree: true })
          .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity);
        await Promise.all(arrivals.map((animation) => animation.finished.catch(() => {})));
      });
    }
    const businessButton = page.getByRole("button", { name: /기업 AI 고객센터/ });
    const personalButton = page.getByRole("button", { name: /개인 부품 교체와 새 PC/ });
    const stage = page.getByRole("region", { name: "AI 팀 업무 소개", exact: true });
    async function runningStageAnimations() {
      return stage.evaluate(
        (element) =>
          element
            .getAnimations({ subtree: true })
            .filter((animation) => animation.playState === "running").length,
      );
    }
    try {
      await welcome();
      await capture("welcome");
      if (phase === "before" || preview) continue;
      await capture("welcome-viewport", false);
      const entryBounds = await page.locator(".pc-entry-choices").evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom };
      });
      if (width >= 1024)
        check(
          "데스크톱의 기업·개인 선택이 첫 화면 안",
          entryBounds.y >= 0 && entryBounds.bottom <= height,
          entryBounds,
        );
      console.log(JSON.stringify({ stage: "welcome-ready", width, height, entryBounds }));

      await expect(stage).toBeVisible();
      await expect(stage).toHaveAttribute("data-motion", "playing");
      check(
        "팀 업무 소개가 실제 처리 화면과 구별됨",
        (await stage.innerText()).includes("업무 소개"),
      );
      const descriptions = [];
      for (const [index, team] of teamLabels.entries()) {
        const button = stage.getByRole("button", { name: `${team} 업무 소개`, exact: true });
        await button.click();
        await expect(button).toHaveAttribute("aria-pressed", "true");
        await expect(
          stage.locator('button[aria-label$=" 업무 소개"][aria-pressed="true"]'),
        ).toHaveCount(1);
        await expect(stage.locator(".bw-stage-connection.is-selected")).toHaveCount(1);
        const description = await stage.locator(".bw-stage-description").innerText();
        descriptions.push(description);
        check(`${team}: 업무 설명 표시`, description.trim().length > 0, { description });
        await capture(`team-${index + 1}`);
      }
      check("네 팀의 업무 설명이 서로 다름", new Set(descriptions).size === 4);
      const firstTeam = stage.getByRole("button", {
        name: `${teamLabels[0]} 업무 소개`,
        exact: true,
      });
      const secondTeam = stage.getByRole("button", {
        name: `${teamLabels[1]} 업무 소개`,
        exact: true,
      });
      await firstTeam.focus();
      await page.keyboard.press("Tab");
      await expect(secondTeam).toBeFocused();
      const focusStyle = await secondTeam.evaluate((element) => ({
        outlineStyle: getComputedStyle(element).outlineStyle,
        outlineWidth: getComputedStyle(element).outlineWidth,
        boxShadow: getComputedStyle(element).boxShadow,
      }));
      check(
        "팀 버튼 키보드 포커스가 보임",
        (focusStyle.outlineStyle !== "none" && focusStyle.outlineWidth !== "0px") ||
          focusStyle.boxShadow !== "none",
        focusStyle,
      );
      await page.keyboard.press("Enter");
      await expect(secondTeam).toHaveAttribute("aria-pressed", "true");
      check("Tab·Enter로 팀 업무 소개 선택", true);
      await stage.getByRole("button", { name: "움직임 멈춤", exact: true }).click();
      await expect(stage).toHaveAttribute("data-motion", "paused");
      await expect.poll(runningStageAnimations).toBe(0);
      check("움직임 멈춤이 장식 애니메이션을 멈춤", true);
      await capture("motion-paused");
      await stage.getByRole("button", { name: "움직임 재생", exact: true }).focus();
      await page.keyboard.press("Space");
      await expect(stage).toHaveAttribute("data-motion", "playing");
      check("키보드로 움직임 다시 재생", true);

      await businessButton.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("form", { name: "기업용 로그인", exact: true })).toBeVisible();
      check("키보드로 기업 로그인 진입", true);
      await capture("business-login");
      await page.getByRole("button", { name: "로그인", exact: true }).click();
      await expect(page.getByRole("alert")).toContainText("아이디와 비밀번호를 모두 입력");
      check("빈 로그인 정보 오류 안내", true);
      await page.getByRole("button", { name: "회원가입", exact: true }).click();
      await page.getByRole("textbox", { name: "아이디", exact: true }).fill("시연확인");
      await page.locator("#pc-password").fill("entry-demo-only");
      await page.getByRole("button", { name: "보기", exact: true }).click();
      await expect(page.locator("#pc-password")).toHaveAttribute("type", "text");
      await page.getByRole("button", { name: "숨기기", exact: true }).click();
      await expect(page.locator("#pc-password")).toHaveAttribute("type", "password");
      check("시연 비밀번호 보기·숨기기", true);
      await page.getByRole("textbox", { name: "기업 인증번호" }).fill("INVALID");
      await page.getByRole("button", { name: "회원가입", exact: true }).click();
      await expect(page.getByRole("alert")).toContainText("등록되지 않은 기업 인증번호");
      await expect(page.getByRole("textbox", { name: "기업 인증번호" })).toBeFocused();
      check("잘못된 기업 인증번호 차단·포커스 이동", true);
      await capture("business-signup-invalid");
      await page.getByRole("textbox", { name: "기업 인증번호" }).fill("BW-2002");
      await page.getByRole("button", { name: "회원가입", exact: true }).click();
      await expect(
        page.getByText("시연 회원가입이 완료되었습니다.", { exact: false }),
      ).toBeVisible();
      await expect(page.getByRole("combobox", { name: "시연 기업" })).toHaveValue("BW-2002");
      await expect(page.locator("#pc-password")).toHaveValue("");
      check("유효한 기업 인증번호로 시연 가입·비밀번호 초기화", true);
      await page.getByRole("button", { name: "관리자로 시연", exact: true }).click();
      await expect(page.locator(".seller-workspace")).toBeVisible();
      await expect(page.locator(".shell-account")).toContainText(
        "테스트컴퓨터 · 가상관리 · 관리자",
      );
      check("관리자 시연과 가입 기업 선택 유지", true);
      await capture("business-home");

      await welcome();
      await businessButton.click();
      await page.getByRole("button", { name: "상담원으로 시연", exact: true }).click();
      await expect(page.locator(".seller-workspace")).toBeVisible();
      await expect(page.locator(".shell-account")).toContainText("가상상담 · 상담원");
      check(
        "상담원 시연과 관리자 메뉴 권한 표시",
        (await page.locator('.business-nav button[aria-label$="관리자 전용"]').count()) > 0,
      );

      await welcome();
      await personalButton.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("form", { name: "개인용 로그인", exact: true })).toBeVisible();
      await capture("personal-login");
      await page.getByRole("button", { name: "회원가입", exact: true }).click();
      await expect(page.getByRole("textbox", { name: "기업 인증번호" })).toHaveCount(0);
      await page.getByRole("textbox", { name: "아이디", exact: true }).fill("개인시연확인");
      await page.locator("#pc-password").fill("entry-demo-only");
      await page.getByRole("button", { name: "회원가입", exact: true }).click();
      await expect(
        page.getByText("시연 회원가입이 완료되었습니다.", { exact: false }),
      ).toBeVisible();
      check("개인 가입은 기업 인증번호 없이 완료", true);
      await page.getByRole("button", { name: /개인용 시연으로 시작/ }).click();
      await expect(page.locator(".pc-type-screen")).toBeVisible();
      check("개인 시연이 기존 상담 화면으로 연결됨", true);
      await capture("personal-consultation");
      await page.getByRole("button", { name: /신규 PC 조립/ }).click();
      await expect(page.locator(".pc-consult-window")).toHaveJSProperty("open", true);
      await expect(page.locator("#pc-budget")).toBeVisible();
      check("시작 화면에서 개인 상담 설문까지 연결됨", true);
      await capture("personal-survey", false);
      const savedPassword = await page.evaluate(() =>
        [...Object.values(localStorage), ...Object.values(sessionStorage)].some((value) =>
          value.includes("entry-demo-only"),
        ),
      );
      check("시연 비밀번호를 브라우저 저장소에 저장하지 않음", !savedPassword);

      await page.emulateMedia({ reducedMotion: "reduce" });
      await welcome();
      await expect(stage).toBeVisible();
      await expect.poll(runningStageAnimations).toBe(0);
      check("움직임 줄이기 설정에서 장식 애니메이션 없음", true);
      await stage.getByRole("button", { name: "검증팀 업무 소개", exact: true }).click();
      await expect(
        stage.getByRole("button", { name: "검증팀 업무 소개", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      check("움직임 줄이기에서도 팀 소개 선택 가능", true);
      await capture("reduced-motion");
      check("페이지 오류 없음", result.errors.length === 0, { errors: result.errors });
      check("백엔드 호출 없음", result.apiRequests.length === 0, {
        apiRequests: result.apiRequests,
      });
    } catch (error) {
      failures.push(`${width}x${height}: ${error.message}`);
      result.flowError = error.message;
      await capture("failure");
    } finally {
      await page.close();
      await writeFile(
        new URL("report.json", output),
        JSON.stringify({ phase, report, failures }, null, 2),
      );
    }
  }
} finally {
  await browser.close();
}
console.log(
  JSON.stringify(
    {
      phase,
      viewports: report.map(({ width, height, captures, checks, flowError }) => ({
        width,
        height,
        captures: captures.length,
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
expect(failures, "Entry experience, keyboard controls and demo login").toEqual([]);
