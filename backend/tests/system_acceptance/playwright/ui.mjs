// 현재 UI 전용 시스템 검증. 성공 API 응답을 Mock으로 대체하지 않습니다.
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const [project, output, baseUrl, scope, delay, channel, headed] =
  process.argv.slice(2);
const require = createRequire(path.join(project, "frontend", "package.json"));
const { chromium, expect } = require("@playwright/test");
const cases = [],
  actions = [],
  network = [];
let browser, context, page;
class Blocked extends Error {}

const escape = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
async function act(label, operation) {
  actions.push({ time: new Date().toISOString(), action: label });
  await operation();
}
async function click(locator, label) {
  await act("클릭: " + label, () => locator.click());
}
async function capture(id) {
  const filename = id + ".png";
  await page.screenshot({ path: path.join(output, filename), fullPage: true });
  fs.writeFileSync(
    path.join(output, id + ".txt"),
    await page.locator("body").innerText(),
  );
  return filename;
}
async function test(id, expected, operation) {
  const start = Date.now();
  let result = "Pass",
    detail = expected,
    screenshot = "";
  try {
    detail = (await operation()) ?? expected;
  } catch (error) {
    result = error instanceof Blocked ? "Blocked" : "Fail";
    detail = error.message;
  }
  try {
    screenshot = await capture(id);
  } catch (error) {
    if (result === "Pass") {
      result = "Fail";
      detail = "캡처 실패: " + error.message;
    }
  }
  cases.push({
    id,
    expected,
    result,
    detail,
    screenshot,
    seconds: (Date.now() - start) / 1000,
  });
  console.log(result + " | " + id + " | " + detail.slice(0, 180));
  return result === "Pass";
}
async function login(role) {
  await page.goto(baseUrl);
  await click(
    page.getByRole("button", {
      name: role === "관리자" ? "관리자로 시연" : "상담원으로 시연",
    }),
    role + "로 시연",
  );
}
async function ui() {
  await page.goto(baseUrl);
  await test("UI-001", "기업용 계정 선택 버튼을 표시한다", async () => {
    await expect(
      page.getByRole("button", { name: "기업용", exact: true }),
    ).toBeVisible();
  });
  await test(
    "UI-002",
    "빈 로그인 제출에 필수 입력 안내를 표시한다",
    async () => {
      await click(
        page.getByRole("button", { name: "로그인", exact: true }),
        "빈 로그인",
      );
      await expect(page.getByRole("alert")).toHaveText(
        "아이디와 비밀번호를 모두 입력해 주세요.",
      );
    },
  );
  await test(
    "UI-003",
    "비밀번호 보기로 입력 형식을 text로 바꾼다",
    async () => {
      await click(
        page.getByRole("button", { name: "비밀번호 보기", exact: true }),
        "비밀번호 보기",
      );
      await expect(page.locator("#pc-password")).toHaveAttribute(
        "type",
        "text",
      );
    },
  );
  await test("UI-004", "회원가입 양식을 표시한다", async () => {
    await click(
      page.getByRole("button", { name: "회원가입", exact: true }),
      "회원가입",
    );
    await expect(
      page.getByRole("form", { name: "기업용 회원가입" }),
    ).toBeVisible();
  });
  await test("UI-005", "로그인 양식으로 복귀한다", async () => {
    await click(
      page.getByRole("button", { name: "로그인으로 돌아가기" }),
      "로그인 복귀",
    );
    await expect(
      page.getByRole("form", { name: "기업용 로그인" }),
    ).toBeVisible();
  });
  const admin = await test(
    "UI-006",
    "관리자 시연으로 기업 메뉴에 진입한다",
    async () => {
      await login("관리자");
      await expect(
        page.getByRole("navigation", { name: "기업 메뉴" }),
      ).toBeVisible();
    },
  );
  if (admin) {
    const nav = page.getByRole("navigation", { name: "기업 메뉴" });
    const labels = await nav.getByRole("button").allTextContents();
    for (let i = 0; i < labels.length; i++) {
      await test(
        "UI-MENU-" + String(i + 1).padStart(2, "0"),
        labels[i] + " 화면 제목을 표시한다",
        async () => {
          await click(nav.getByRole("button").nth(i), labels[i]);
          await expect(page.locator(".header-context")).toContainText(
            labels[i].trim(),
          );
        },
      );
    }
    await test(
      "UI-007",
      "문서 관리 화면에 시연 데이터 경계를 표시한다",
      async () => {
        await click(
          nav.getByRole("button", { name: "상품 · 정책", exact: true }),
          "상품·정책",
        );
        await click(
          page.getByRole("button", { name: "문서 · 응대 자료", exact: true }),
          "문서·응대 자료",
        );
        await expect(
          page.getByText("파일 내용은 읽거나 외부로 전송하지 않습니다.", {
            exact: true,
          }),
        ).toBeVisible();
      },
    );
  }
  const agent = await test(
    "UI-008",
    "상담원 시연으로 기업 메뉴에 진입한다",
    async () => {
      await login("상담원");
      await expect(
        page.getByRole("navigation", { name: "기업 메뉴" }),
      ).toBeVisible();
    },
  );
  if (agent) {
    const locked = page
      .getByRole("navigation", { name: "기업 메뉴" })
      .getByRole("button", { name: /관리자 전용/ });
    const count = await locked.count();
    await test("UI-009", "관리자 전용 메뉴가 존재한다", async () => {
      expect(count).toBeGreaterThan(0);
    });
    for (let i = 0; i < count; i++) {
      await test(
        "UI-ACCESS-" + String(i + 1).padStart(2, "0"),
        "상담원에게 관리자 전용 제한 안내를 표시한다",
        async () => {
          await click(locked.nth(i), (await locked.nth(i).innerText()).trim());
          await expect(
            page.getByText("관리자만 사용할 수 있습니다.", { exact: true }),
          ).toBeVisible();
        },
      );
    }
  }
}
async function consultation() {
  let selected = [],
    total = 0,
    quote;
  const entry = await test(
    "PC-001",
    "개인 상담 세션 생성 API가 201을 반환한다",
    async () => {
      await page.goto(baseUrl);
      await click(
        page.getByRole("button", { name: "개인용", exact: true }),
        "개인용",
      );
      const response = page.waitForResponse(
        (r) => r.url().endsWith("/sessions") && r.request().method() === "POST",
        { timeout: 30000 },
      );
      await click(
        page.getByRole("button", { name: /개인용 시연으로 시작/ }),
        "개인용 시연으로 시작",
      );
      expect((await response).status()).toBe(201);
    },
  );
  let current;
  const ready = await test(
    "PC-002",
    "설문 검토 후 후보 API가 200을 반환한다",
    async () => {
      if (!entry)
        throw new Blocked("개인 상담 세션 생성 실패로 후보 검증 불가");
      await click(page.locator(".pc-type-new"), "새 PC 구성");
      await act("입력: 전체 예산 3800000", () =>
        page.locator("#pc-budget").fill("3800000"),
      );
      await act("선택: 고사양 게임", () =>
        page.getByRole("checkbox", { name: /고사양 게임/ }).check(),
      );
      await capture("PC-survey");
      await click(page.locator(".pc-survey button[type=submit]"), "설문 제출");
      await capture("PC-review");
      const response = page.waitForResponse(
        (r) => r.url().endsWith("/candidates"),
        { timeout: 60000 },
      );
      await click(page.locator(".pc-review .pc-primary"), "설계 요청");
      const received = await response;
      expect(received.status()).toBe(200);
      current = await received.json();
    },
  );
  let continuing = ready;
  for (let i = 0; i < 8; i++) {
    continuing = await test(
      "PC-SELECT-" + String(i + 1).padStart(2, "0"),
      (i === 7 ? "8번째 부품 선택 후 견적" : "부품 선택 후 다음 후보") +
        " API가 200을 반환한다",
      async () => {
        if (!continuing)
          throw new Blocked("앞선 부품 선택 실패로 후속 단계 검증 불가");
        const chosen = current.passed[0] ?? current.needsReview[0];
        if (!chosen) throw Error("선택 가능한 후보가 없습니다.");
        if (!current.passed.length) {
          const unknown = page.locator(".pc-unknown");
          if ((await unknown.getAttribute("open")) === null)
            await click(
              unknown.locator("summary").first(),
              "확인 필요 후보 펼치기",
            );
        }
        const next = page.waitForResponse(
          (r) => r.url().endsWith(i === 7 ? "/quotes" : "/candidates"),
          { timeout: 60000 },
        );
        await click(
          page
            .getByTestId("pc-candidate")
            .filter({
              has: page.getByRole("heading", {
                name: chosen.part.name,
                exact: true,
              }),
            })
            .first()
            .getByRole("button", { name: /선택/ }),
          chosen.part.name + " 선택",
        );
        if (!current.passed.length)
          await click(
            page.getByRole("button", { name: "주의사항을 확인하고 선택" }),
            "주의사항 확인",
          );
        const received = await next;
        expect(received.status()).toBe(200);
        selected.push(chosen.part.part_id);
        total += chosen.part.current_price;
        current = await received.json();
        if (i === 7) quote = current;
      },
    );
  }
  await test(
    "PC-003",
    "견적 항목 ID가 선택한 8개 부품과 일치한다",
    async () => {
      if (!quote) throw new Blocked("견적 생성 미완료");
      expect(
        quote.items.map((item) => item.part_id).sort((a, b) => a - b),
      ).toEqual([...selected].sort((a, b) => a - b));
      return JSON.stringify(selected);
    },
  );
  await test(
    "PC-004",
    "견적 총액이 선택 부품의 단가 합계와 일치한다",
    async () => {
      if (!quote) throw new Blocked("견적 생성 미완료");
      expect(quote.total_amount).toBe(total);
      return (
        "선택 합계=" +
        total +
        ", 견적 총액=" +
        quote.total_amount +
        " (DB 테스트 가격)"
      );
    },
  );
  await test("PC-005", "견적 v1 화면을 표시한다", async () => {
    if (!quote) throw new Blocked("견적 생성 미완료");
    await expect(page.locator(".pc-quote-screen")).toContainText("견적 v1");
  });
  await test("PC-RAG-001", "견적 검증에 RAG 인용 근거가 있다", async () => {
    if (!quote) throw new Blocked("견적 생성 미완료");
    const text = await page.locator("body").innerText();
    if (text.includes("RAG 검색 오류"))
      throw new Blocked(
        text.split("\n").find((line) => line.includes("RAG 검색 오류")),
      );
    expect(quote.validation.citations.length).toBeGreaterThan(0);
  });
}

try {
  browser = await chromium.launch({
    ...(channel === "chromium" ? {} : { channel }),
    headless: headed !== "true",
    slowMo: Number(delay),
  });
  context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await context.tracing.start({
    screenshots: true,
    snapshots: true,
    sources: true,
  });
  page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith("/api/"))
      network.push({
        time: new Date().toISOString(),
        path: url.pathname,
        status: response.status(),
      });
  });
  page.on("pageerror", (error) =>
    actions.push({ action: "브라우저 오류", detail: error.message }),
  );
  if (scope === "ui" || scope === "all") await ui();
  if (scope === "consultation" || scope === "all") await consultation();
} catch (error) {
  cases.push({
    id: "ENV-001",
    expected: "브라우저와 테스트 환경이 실행된다",
    result: "Blocked",
    detail: error.message,
    seconds: 0,
  });
} finally {
  try {
    if (context)
      await context.tracing.stop({ path: path.join(output, "trace.zip") });
  } finally {
    if (browser) await browser.close();
  }
  fs.writeFileSync(
    path.join(output, "results.json"),
    JSON.stringify({ baseUrl, scope, cases, actions, network }, null, 2),
  );
  fs.writeFileSync(
    path.join(output, "button-log.json"),
    JSON.stringify(actions, null, 2),
  );
  const rows = cases
    .map(
      (c) =>
        "<tr><td>" +
        escape(c.id) +
        "</td><td>" +
        c.result +
        "</td><td>" +
        escape(c.expected) +
        "</td><td>" +
        escape(c.detail) +
        "</td><td>" +
        (c.screenshot ? '<a href="' + c.screenshot + '">화면</a>' : "") +
        "</td></tr>",
    )
    .join("");
  fs.writeFileSync(
    path.join(output, "index.html"),
    '<!doctype html><html lang="ko"><meta charset="utf-8"><title>BUILDWISE UI 검증</title>' +
      "<style>body{font:15px sans-serif;margin:30px}td,th{padding:10px;border:1px solid #ccc;" +
      "text-align:left}table{border-collapse:collapse}</style><h1>현재 UI 검증</h1>" +
      "<p>실제 인증·음성·결제 검증 제외. 기업 운영 데이터는 시연용입니다.</p>" +
      "<table><tr><th>ID</th><th>결과</th><th>기대 결과</th><th>확인 내역</th><th>캡처</th></tr>" +
      rows +
      "</table></html>",
  );
}
process.exitCode = cases.some((c) => c.result === "Fail")
  ? 1
  : cases.some((c) => c.result === "Blocked")
    ? 2
    : 0;
