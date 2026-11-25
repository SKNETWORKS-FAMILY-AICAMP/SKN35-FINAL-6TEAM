// 시트의 미실행 케이스를 원래 기대 결과로 실행합니다. 성공 API는 대체하지 않습니다.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const [
  project,
  output,
  baseUrl,
  scope,
  delay,
  channel,
  headed,
  caseFilter = "",
] = process.argv.slice(2);
const require = createRequire(path.join(project, "frontend/package.json"));
const { chromium, expect } = require("@playwright/test");
const catalog = JSON.parse(
  fs
    .readFileSync(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "functional-cases.json",
      ),
      "utf8",
    )
    .replace(/^\uFEFF/, ""),
);
const selectedCatalog = catalog.filter(
  (c) => !caseFilter || caseFilter.split(",").includes(c.id),
);
const results = [],
  actions = [],
  network = [],
  handlers = new Map();
let browser,
  context,
  page,
  currentCase = "",
  actual = "",
  cachedCandidate,
  cachedQuote;
class Blocked extends Error {}
const def = (id, fn) => handlers.set(id, fn);
const button = (name) => page.getByRole("button", { name, exact: true });
const seen = async (locator) => {
  await expect(locator.first()).toBeVisible();
  actual = (await locator.first().innerText()).slice(0, 1500);
};
const absent = async (locator) => {
  await expect(locator).toHaveCount(0);
  actual = "해당 요소 0개";
};
async function click(locator, label) {
  actions.push({
    id: currentCase,
    time: new Date().toISOString(),
    action: "클릭",
    target: label ?? (await locator.first().innerText()),
  });
  await locator.first().click();
}
async function fill(locator, value) {
  actions.push({
    id: currentCase,
    time: new Date().toISOString(),
    action: "입력",
    target:
      (await locator.getAttribute("aria-label")) ??
      (await locator.getAttribute("id")),
    value,
  });
  await locator.fill(value);
}
async function select(locator, value) {
  actions.push({ id: currentCase, action: "선택", value });
  await locator.selectOption(value);
}
async function start(kind = "business", signup = false) {
  if (page === cachedQuote?.page) {
    page = await context.newPage();
    page.setDefaultTimeout(5000);
    page.setDefaultNavigationTimeout(20000);
  }
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.goto(baseUrl);
  if (kind === "personal") await click(button("개인용"));
  if (signup) await click(button("회원가입"));
}
async function credentials() {
  await fill(page.locator("[name=userId]"), "ui-functional-demo");
  await fill(page.locator("[name=password]"), "test-only");
}
async function business(menu = "기업 홈", role = "admin") {
  await start();
  await click(button(role === "admin" ? "관리자로 시연" : "상담원으로 시연"));
  if (menu !== "기업 홈")
    await click(
      page
        .getByRole("navigation", { name: "기업 메뉴" })
        .getByRole("button", { name: menu, exact: role === "admin" }),
    );
}
async function personal() {
  await start("personal");
  const res = page.waitForResponse(
    (r) => r.url().endsWith("/sessions") && r.request().method() === "POST",
    { timeout: 20000 },
  );
  await click(page.getByRole("button", { name: /개인용 시연으로 시작/ }));
  const r = await res;
  if (r.status() !== 201)
    throw new Blocked("상담 세션 생성 HTTP " + r.status());
}
async function survey(mode = "new") {
  await personal();
  await click(
    page.locator(mode === "new" ? ".pc-type-new" : ".pc-type-card").first(),
  );
  await expect(page.locator(".pc-survey")).toBeVisible();
}
async function validSurvey(mode = "new") {
  await survey(mode);
  await fill(page.locator("#pc-budget"), mode === "new" ? "3800000" : "800000");
  await page.getByRole("checkbox", { name: /고사양 게임/ }).check();
}
async function review(budget = "3800000") {
  await validSurvey();
  await fill(page.locator("#pc-budget"), budget);
  await click(page.locator(".pc-survey button[type=submit]"));
  await expect(page.locator(".pc-review")).toBeVisible();
}
async function candidates(fresh = false, budget = "3800000") {
  if (!fresh && cachedCandidate && !cachedCandidate.page.isClosed()) {
    page = cachedCandidate.page;
    return cachedCandidate.data;
  }
  for (const stale of context.pages()) {
    if (stale !== cachedQuote?.page) await stale.close();
  }
  page = await context.newPage();
  page.setDefaultTimeout(5000);
  page.setDefaultNavigationTimeout(20000);
  await review(budget);
  const res = page.waitForResponse((r) => r.url().endsWith("/candidates"), {
    timeout: 45000,
  });
  await click(page.locator(".pc-review .pc-primary"));
  const r = await res;
  if (r.status() !== 200) throw new Blocked("후보 조회 HTTP " + r.status());
  const data = await r.json();
  await expect(page.locator(".pc-selection")).toBeVisible();
  if (budget === "3800000") cachedCandidate = { page, data };
  return data;
}
async function chooseCandidate(data, endpoint = "/candidates") {
  const item = data.passed[0] ?? data.needsReview[0];
  if (!item) throw new Blocked("현재 데이터에 선택 가능한 후보 없음");
  if (!data.passed.length) {
    const d = page.locator(".pc-unknown");
    if ((await d.getAttribute("open")) === null)
      await click(d.locator("summary").first());
  }
  const res = page.waitForResponse((r) => r.url().endsWith(endpoint), {
    timeout: 45000,
  });
  await click(
    page
      .getByTestId("pc-candidate")
      .filter({
        has: page.getByRole("heading", { name: item.part.name, exact: true }),
      })
      .first()
      .getByRole("button", { name: /선택/ }),
  );
  if (!data.passed.length) await click(button("주의사항을 확인하고 선택"));
  const r = await res;
  if (r.status() !== 200) throw new Blocked(endpoint + " HTTP " + r.status());
  return await r.json();
}
async function quotation(fresh = false) {
  if (!fresh && cachedQuote && !cachedQuote.page.isClosed()) {
    page = cachedQuote.page;
    await page.unrouteAll({ behavior: "ignoreErrors" });
    if (await page.locator(".pc-quote-screen").count()) {
      if (await button("최신 견적 보기").count())
        await click(button("최신 견적 보기"));
      return cachedQuote.data;
    }
    cachedQuote = null;
  }
  let data = await candidates(true);
  for (let i = 0; i < 8; i++)
    data = await chooseCandidate(data, i === 7 ? "/quotes" : "/candidates");
  cachedCandidate = null;
  cachedQuote = { page, data };
  return data;
}
async function reviewCandidates() {
  let data = await candidates(true);
  for (let i = 0; i < 7 && !data.needsReview.length; i++)
    data = await chooseCandidate(data);
  return data;
}
async function unknownDialog() {
  const data = await reviewCandidates();
  if (!data.needsReview.length)
    throw new Blocked("현재 후보에 확인 필요 데이터 없음");
  const d = page.locator(".pc-unknown");
  if ((await d.getAttribute("open")) === null)
    await click(d.locator("summary").first());
  const item = data.needsReview[0];
  await click(
    d
      .getByTestId("pc-candidate")
      .filter({
        has: page.getByRole("heading", { name: item.part.name, exact: true }),
      })
      .getByRole("button", { name: /선택/ }),
  );
  await expect(page.getByRole("dialog")).toBeVisible();
  return item;
}
async function budget(preview = false) {
  let initial = await candidates(true),
    original = null;
  if (preview) {
    const chosen = initial.passed[Math.min(9, initial.passed.length - 1)];
    if (!chosen) throw new Blocked("재배분용 통과 CPU 없음");
    original = { category: chosen.part.category, id: chosen.part.part_id };
    await chooseCandidate({ ...initial, passed: [chosen] });
  }
  const btn = page
    .getByRole("button", { name: /이 부품에 예산 더 쓰기/ })
    .first();
  await click(btn);
  await expect(page.locator(".pc-budget-screen")).toBeVisible();
  if (preview) {
    await fill(page.getByRole("textbox", { name: "이 부품 예산" }), "3800000");
    const res = page.waitForResponse((r) => r.url().endsWith("/rebalance"), {
      timeout: 45000,
    });
    await click(button("새 후보와 배분 확인"));
    const r = await res;
    if (r.status() !== 200) throw new Blocked("재배분 HTTP " + r.status());
    await expect(page.locator(".pc-budget-results")).toBeVisible({
      timeout: 20000,
    });
    return { ...(await r.json()), __original: original };
  }
}
async function owned() {
  await validSurvey("replacement");
  await click(page.locator(".pc-owned summary").filter({ hasText: "CPU" }));
}
async function ownedSearch(query = "Ryzen") {
  await owned();
  const response = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname.endsWith("/parts") &&
      new URL(r.url()).searchParams.get("query") === query,
    { timeout: 20000 },
  );
  await fill(page.locator("#pc-search-cpu"), query);
  const r = await response;
  if (r.status() !== 200)
    throw new Blocked("보유 부품 검색 HTTP " + r.status());
  return await r.json();
}
async function manualCPU() {
  await owned();
  await fill(page.locator("#pc-manual-cpu"), "QA 보유 CPU");
  await click(
    page
      .locator(".pc-owned")
      .filter({ has: page.locator("#pc-manual-cpu") })
      .getByRole("button", { name: "추가", exact: true }),
  );
}
async function catalogTab(tab) {
  await business("상품 · 정책");
  await click(button(tab));
}
async function issue() {
  await business("상담 · 이슈");
  await click(page.locator(".seller-issue-card").first());
  await expect(page.getByRole("dialog")).toBeVisible();
}
async function customer() {
  await business("고객 정보");
  await click(page.getByRole("button", { name: /시연 고객 01 상세 보기/ }));
  await expect(page.getByRole("dialog")).toBeVisible();
}
async function employee() {
  await business("AI 직원 · 사람 직원");
}
async function assign() {
  await issue();
  const s = page.getByRole("combobox", { name: "담당자 선택" });
  const options = await s.locator("option").all();
  if (options.length < 2) throw new Blocked("배정 가능한 시연 직원 없음");
  const name = await options[1].getAttribute("value");
  await select(s, name);
  await click(button("담당자 지정"));
  return name;
}

for (let n = 6; n <= 34; n++)
  def("BW-C-" + String(n).padStart(3, "0"), async () => {
    await start();
    const id = page.locator("[name=userId]"),
      pw = page.locator("#pc-password");
    switch (n) {
      case 6:
        await seen(page.locator(".bw-entry-wordmark"));
        expect(actual).toContain("BUILDWISE");
        break;
      case 7:
        await seen(page.getByText("시연 공간", { exact: true }));
        break;
      case 8:
        await click(button("개인용"));
        await expect(button("개인용")).toHaveAttribute("aria-pressed", "true");
        actual = "개인용 aria-pressed=true";
        break;
      case 9:
        await click(button("개인용"));
        await click(button("기업용"));
        await expect(button("기업용")).toHaveAttribute("aria-pressed", "true");
        actual = "기업용 aria-pressed=true";
        break;
      case 10:
        await click(button("개인용"));
        await seen(page.getByRole("button", { name: /개인용 시연으로 시작/ }));
        break;
      case 11:
        await seen(page.getByRole("button", { name: /관리자로 시연/ }));
        break;
      case 12:
        await seen(page.getByRole("button", { name: /상담원으로 시연/ }));
        break;
      case 13:
        await fill(id, "ui-demo");
        await expect(id).toHaveValue("ui-demo");
        actual = await id.inputValue();
        break;
      case 14:
        await fill(id, "a".repeat(51));
        expect((await id.inputValue()).length).toBeLessThanOrEqual(50);
        actual = "길이 " + (await id.inputValue()).length;
        break;
      case 15:
        await fill(pw, "demo");
        await click(button("로그인"));
        await seen(page.getByRole("alert"));
        expect(actual).toContain("아이디");
        break;
      case 16:
        await fill(id, "demo");
        await click(button("로그인"));
        await seen(page.getByRole("alert"));
        expect(actual).toContain("비밀번호");
        break;
      case 17:
        await fill(pw, "demo");
        await click(button("로그인"));
        await expect(id).toBeFocused();
        actual = "아이디 포커스";
        break;
      case 18:
        await fill(id, "   ");
        await fill(pw, "demo");
        await click(button("로그인"));
        await seen(page.getByRole("alert"));
        expect(actual).toContain("아이디");
        break;
      case 19:
        await expect(pw).toHaveAttribute("type", "password");
        actual = "type=password";
        break;
      case 20:
        await click(button("비밀번호 보기"));
        await click(button("비밀번호 숨기기"));
        await expect(pw).toHaveAttribute("type", "password");
        actual = "type=password";
        break;
      case 21:
        await expect(
          page.getByRole("combobox", { name: "시연 기업" }).locator("option"),
        ).toHaveCount(2);
        actual = await page
          .getByRole("combobox", { name: "시연 기업" })
          .innerText();
        break;
      case 22:
        await select(page.getByRole("combobox", { name: "시연 기업" }), {
          label: "테스트컴퓨터",
        });
        await click(page.getByRole("button", { name: /관리자로 시연/ }));
        await seen(page.locator(".shell-company-card"));
        expect(actual).toContain("테스트컴퓨터");
        break;
      case 23:
        await credentials();
        await click(button("로그인"));
        await seen(page.getByRole("navigation", { name: "기업 메뉴" }));
        break;
      case 24:
        await click(button("회원가입"));
        await seen(page.getByRole("textbox", { name: "기업 인증번호" }));
        break;
      case 25:
        await click(button("회원가입"));
        await seen(page.getByText(/시연 번호: BW-1001/));
        break;
      case 26:
        await click(button("회원가입"));
        await credentials();
        await fill(
          page.getByRole("textbox", { name: "기업 인증번호" }),
          "INVALID",
        );
        await click(button("회원가입"));
        await seen(page.getByRole("alert"));
        expect(actual).toContain("등록되지 않은 기업 인증번호");
        break;
      case 27:
        await click(button("회원가입"));
        await credentials();
        await fill(
          page.getByRole("textbox", { name: "기업 인증번호" }),
          "BW-1001",
        );
        await click(button("회원가입"));
        await seen(page.getByRole("status"));
        expect(actual).toContain("시연 회원가입이 완료");
        break;
      case 28:
        await click(button("개인용"));
        await click(button("회원가입"));
        await absent(page.getByRole("textbox", { name: "기업 인증번호" }));
        break;
      case 29:
        await click(button("개인용"));
        await click(button("회원가입"));
        await credentials();
        await click(button("회원가입"));
        await seen(page.getByRole("status"));
        expect(actual).toContain("시연 회원가입이 완료");
        break;
      case 30:
        await click(button("회원가입"));
        await seen(
          page.getByText("실제 계정이 저장되지 않는 시연 회원가입입니다.", {
            exact: true,
          }),
        );
        break;

      case 31:
        await click(button("개인용"));
        await credentials();
        await click(button("로그인"));
        await seen(page.locator(".app-shell-personal"));
        break;
      case 32:
        await business();
        await click(button("로그아웃"));
        await seen(page.locator(".entry-shell"));
        break;
      case 33:
        if (!(await page.locator(".bw-entry-art > summary").isVisible()))
          throw new Blocked(
            "데스크톱 1440px에서 팀 소개 접기 제어가 CSS로 숨겨짐. 모바일 전용 기능으로 케이스 적용 범위 확인 필요",
          );
        await click(page.locator(".bw-entry-art > summary"));
        await expect(page.locator(".bw-entry-art")).not.toHaveAttribute(
          "open",
          "",
        );
        actual = "팀 소개 접힘";
        break;
      case 34:
        if (!(await page.locator(".bw-entry-art > summary").isVisible()))
          throw new Blocked(
            "데스크톱 1440px에서 팀 소개 펼치기 제어가 CSS로 숨겨짐. 모바일 전용 기능으로 케이스 적용 범위 확인 필요",
          );
        await click(page.locator(".bw-entry-art > summary"));
        await click(page.locator(".bw-entry-art > summary"));
        await expect(page.locator(".bw-entry-art")).toHaveAttribute("open", "");
        actual = "팀 소개 펼침";
        break;
    }
  });
for (let n = 15; n <= 70; n++)
  def("BW-B-" + String(n).padStart(3, "0"), async () => {
    if (n <= 19) await business();
    if (n === 15) {
      await seen(page.locator(".shell-company-card"));
      expect(actual).toContain("가상전자");
    } else if (n === 16) {
      await seen(page.getByText(/운영 수치는 가상입니다/));
    } else if (n === 17) {
      expect(
        await page
          .locator(".management-team-strip")
          .getByRole("button")
          .count(),
      ).toBe(4);
      actual = "팀 카드 4개";
    } else if (n === 18) {
      await click(
        page.getByRole("button", {
          name: "상담 · 이슈 전체 보기",
          exact: true,
        }),
      );
      await expect(page.locator(".header-context")).toContainText(
        "상담 · 이슈",
      );
      actual = await page.locator(".header-context").innerText();
    } else if (n === 19) {
      await click(page.locator(".management-primary"));
      await expect(page.locator(".header-context")).toContainText(
        "고객 화면 미리보기",
      );
      actual = await page.locator(".header-context").innerText();
    } else if (n === 20) {
      await business();
      await fill(
        page.getByPlaceholder("고객 · 상담 · 인계 검색"),
        "시연 고객 01",
      );
      await seen(page.locator(".b2b-search-results"));
      expect(actual).toContain("시연 고객 01");
    } else if (n >= 21 && n <= 24) {
      await business("상담 · 이슈");
      await seen(
        page.locator(".seller-kanban-heading").getByRole("heading", {
          name: ["받은", "분류됨", "처리 중", "완료"][n - 21],
          exact: true,
        }),
      );
    } else if (n === 25) {
      await issue();
      await seen(page.getByRole("dialog"));
      expect(actual).toContain("시연 배송 일정 확인");
    } else if (n === 26) {
      await issue();
      const lines = page.locator(".seller-chat-history .seller-chat");
      if (!(await lines.count()))
        throw new Blocked(
          "초기 시연 이슈에 첨부된 고객 대화가 0건. 이슈별 대화 데이터가 필요함",
        );
      await seen(lines.first());
    } else if (n === 27) {
      await issue();
      await seen(
        page.locator(".seller-issue-detail .seller-summary-list li").first(),
      );
      expect(actual.length).toBeGreaterThan(0);
    } else if (n === 28) {
      const name = await assign();
      await seen(page.getByRole("dialog"));
      expect(actual).toContain(name);
    } else if (n === 29) {
      await issue();
      await seen(
        page.getByText("담당자를 지정한 뒤 처리를 완료할 수 있어요.", {
          exact: true,
        }),
      );
    } else if (n === 30) {
      await assign();
      await click(button("처리 완료"));
      await seen(
        page.getByText("담당자가 처리를 완료한 인계입니다.", { exact: true }),
      );
    } else if (n === 31) {
      await business("고객 정보");
      await fill(
        page.getByRole("textbox", { name: "고객 검색" }),
        "시연 고객 01",
      );
      await seen(page.locator("tbody"));
      expect(actual).toContain("시연 고객 01");
    } else if (n === 32) {
      await business("고객 정보");
      await select(
        page.getByRole("combobox", { name: "고객 이용 상태" }),
        "blocked",
      );
      const texts = await page.locator("tbody tr").allTextContents();
      expect(texts.length).toBeGreaterThan(0);
      expect(texts.every((t) => t.includes("차단됨"))).toBe(true);
      actual = texts.join("\n");
    } else if (n === 33) {
      await business("고객 정보");
      await click(page.getByRole("button", { name: "학생", exact: true }));
      const texts = await page.locator("tbody tr").allTextContents();
      expect(texts.length).toBeGreaterThan(0);
      expect(texts.every((t) => t.includes("학생"))).toBe(true);
      actual = texts.join("\n");
    } else if (n >= 34 && n <= 39) {
      await customer();
      if (n === 34) {
        await seen(page.getByRole("dialog"));
        expect(actual).toContain("시연 고객 01");
      }
      if (n === 35) {
        await click(page.getByRole("button", { name: /^견적 내역/ }));
        await seen(page.locator(".seller-detail-list"));
        expect(actual).toContain("₩");
      }
      if (n === 36) {
        await click(button("상담 내역"));
        await click(page.locator(".seller-chat-session > summary").first());
        await seen(
          page
            .getByText("영상 편집에 쓸 PC 구성을 상담하고 싶어요.", {
              exact: true,
            })
            .first(),
        );
      }
      if (n === 37) {
        await click(button("상담 요약"));
        await seen(page.getByRole("dialog"));
        expect(actual).toMatch(/요청|추천|주의/);
      }
      if (n === 38 || n === 39) {
        await click(button("고객 차단"));
        await fill(
          page.getByRole("textbox", { name: "차단 사유" }),
          "QA 시연 차단 확인",
        );
        await click(
          page.getByRole("dialog").last().getByRole("button", { name: /차단/ }),
        );
        if (n === 39) await click(button("차단 해제"));
        await seen(page.getByRole("dialog").first());
        expect(actual).toContain(n === 38 ? "차단됨" : "상담 가능");
      }
    } else if (n === 40) {
      await business("고객 정보");
      await click(button("시연 제어 열기"));
      await click(
        page
          .getByRole("complementary", { name: "시연 제어" })
          .getByRole("button", { name: "욕설 감지", exact: true }),
      );
      await click(page.getByRole("button", { name: /악성 사용자 관리/ }));
      await seen(page.getByText(/욕설 감지 · 담당자 확인/));
    } else if (n === 41) {
      await business("고객 화면 미리보기");
      await click(page.locator(".pc-type-new"));
      await seen(page.locator(".pc-survey"));
    } else if (n === 42) {
      await business("고객 화면 미리보기");
      await seen(page.getByText(/가상 기업·고객·판매 데이터/));
    } else if (n === 43) {
      await business("고객 피드백");
      await seen(page.getByText(/가상 고객 피드백:/).first());
    } else if (n === 44) {
      await business("고객 피드백");
      await click(button("할인 정책 한도 검토"));
      await expect(page.locator(".header-context")).toContainText(
        "상품 · 정책",
      );
      actual = await page.locator(".header-context").innerText();
    } else if (n === 45) {
      await business("판매 통계");
      await seen(
        page.getByText("가상 시연 데이터 · 모든 금액은 테스트 가격입니다.", {
          exact: true,
        }),
      );
    } else if (n === 46) {
      await business("판매 통계");
      const buttons = page
        .getByRole("group", { name: "집계 기간" })
        .getByRole("button");
      await click(buttons.nth(1));
      await expect(buttons.nth(1)).toHaveAttribute("aria-pressed", "true");
      actual = await buttons.nth(1).innerText();
    } else if (n === 47) {
      await business("판매 통계");
      await seen(page.getByText("상담 수요와 실제 판매", { exact: true }));
    } else if (n >= 48 && n <= 52) {
      await catalogTab("상품 연결");
      if (n === 48)
        await seen(
          page.getByText(
            "팀 DB에서 추출한 읽기 전용 자료입니다. DB 실시간 연결은 아닙니다.",
            { exact: true },
          ),
        );
      if (n === 49) {
        await seen(page.locator(".b2b-catalog-totals strong").nth(0));
        expect(actual.replace(/\D/g, "")).toBe("9917");
      }
      if (n === 50) {
        await seen(page.locator(".b2b-catalog-totals strong").nth(2));
        expect(actual.replace(/\D/g, "")).toBe("23032");
      }
      if (n === 51) await seen(page.getByText(/2026-11-06 · 테스트 가격/));
      if (n === 52) {
        await click(page.getByRole("button", { name: /판매 정책 설정/ }));
        await seen(page.getByRole("combobox", { name: "추천 순서" }));
      }
    } else if (n >= 53 && n <= 59) {
      await catalogTab("판매 정책");
      if (n === 53) {
        const s = page.getByRole("combobox", { name: "추천 순서" });
        await select(s, "price");
        await expect(s).toHaveValue("price");
        actual = "추천 순서=price";
      }
      if (n === 54) {
        await expect(
          page
            .getByRole("combobox", { name: "추천 순서" })
            .getByRole("option", { name: /재고 우선/ }),
        ).toBeDisabled();
        actual = "재고 우선 disabled";
      }
      if (n === 55) {
        const s = page.getByRole("combobox", { name: "우선 추천 브랜드" });
        await select(s, "AMD");
        await expect(s).toHaveValue("AMD");
        actual = "우선 브랜드=AMD";
      }
      if (n === 56) {
        const s = page.getByRole("spinbutton", {
          name: "할인 자동 응대 한도",
          exact: true,
        });
        await fill(s, "7");
        await expect(s).toHaveValue("7");
        actual = "할인 한도=7";
      }
      if (n === 57) {
        const s = page.getByRole("spinbutton", {
          name: "자동 견적 검토 한도",
          exact: true,
        });
        await fill(s, "2100000");
        await expect(s).toHaveValue("2100000");
        actual = "견적 한도=2100000";
      }
      if (n === 58) {
        await fill(
          page.getByRole("spinbutton", {
            name: "할인 자동 응대 한도",
            exact: true,
          }),
          "7",
        );
        await click(button("정책 저장"));
        await seen(
          page.getByRole("status").filter({ hasText: "정책을 적용했습니다" }),
        );
      }
      if (n === 59) {
        await fill(
          page.getByRole("textbox", { name: "상담 금지 표현" }),
          "최저가 보장",
        );
        await seen(page.getByText(/직원 응답:/));
        expect(actual).toContain("담당자 확인 후 안내");
      }
    } else if (n === 60) {
      await catalogTab("같은 엔진, 다른 기업");
      await click(button("같은 설문으로 비교"));
      await seen(page.locator(".b2b-comparison"));
    } else if (n >= 61 && n <= 64) {
      await catalogTab("문서 · 응대 자료");
      if (n === 61)
        await seen(page.getByText("시연 상품 안내서.pdf", { exact: true }));
      if (n === 62)
        await seen(page.getByText("시연 반영됨", { exact: true }).first());
      if (n === 63) {
        await click(button("문서 올리기"));
        await seen(page.getByRole("dialog"));
      }
      if (n === 64) {
        const s = page.getByRole("textbox", { name: "기본 배송비" });
        await fill(s, "3500");
        await click(button("정책 저장 · 시연"));
        await click(button("상품 연결"));
        await click(button("문서 · 응대 자료"));
        const value = await page
          .getByRole("textbox", { name: "기본 배송비" })
          .inputValue();
        expect(Number(value.replaceAll(",", ""))).toBe(3500);
        actual = "탭 재진입 후 배송비=" + value;
      }
    } else if (n >= 65) {
      await employee();
      if (n === 65) {
        await seen(page.locator(".management-ai-card").first());
        expect(actual).toContain("상담");
      }
      if (n === 66)
        await seen(
          page.getByText(
            "확인 불가 항목과 클레임 처리는 담당자가 결정합니다.",
            { exact: true },
          ),
        );
      if (n === 67) {
        await seen(page.locator(".seller-table"));
        expect(actual).toMatch(/승인 대기|활성/);
      }
      if (n === 68) {
        const before = page
          .locator("tr")
          .filter({ has: button("가입 승인") })
          .first();
        const eid = (await before.innerText()).match(/demo-a-employee-\d+/)[0];
        await click(before.getByRole("button", { name: "가입 승인" }));
        const row = page.locator("tr").filter({ hasText: eid });
        await expect(row.locator("td").nth(2)).toHaveText("활성");
        actual = await row.innerText();
      }
      if (n === 69) {
        const s = page
          .locator("tr")
          .filter({ hasText: "demo-a-employee-2" })
          .getByRole("combobox");
        const before = await s.inputValue();
        await select(s, before === "agent" ? "admin" : "agent");
        await expect(s).toHaveValue(before === "agent" ? "admin" : "agent");
        actual = "권한=" + (await s.inputValue());
      }
      if (n === 70) {
        const row = page.locator("tr").filter({ hasText: "demo-a-employee-2" });
        await click(row.getByRole("button", { name: "비활성화" }));
        await expect(row.locator("td").nth(2)).toHaveText("비활성");
        actual = await row.innerText();
      }
    }
  });

for (let n = 15; n <= 78; n++)
  def("BW-P-" + String(n).padStart(3, "0"), async () => {
    if (n >= 15 && n <= 19) {
      await personal();
      if (n <= 17) {
        const label = ["사무실", "상담", "PC 상담"][n - 15];
        await click(
          page
            .getByRole("navigation", { name: "화면 바로가기" })
            .getByRole("link", { name: label, exact: true }),
        );
        await expect(page).toHaveURL(
          new RegExp(["#workspace", "#conversation", "#results"][n - 15]),
        );
        actual = page.url();
      }
      if (n === 18) {
        expect(await page.locator(".office-room").count()).toBe(4);
        actual = "AI 팀 4개";
      }
      if (n === 19)
        await seen(
          page
            .getByText(/요청을 기다리고 있어요|새 요청을 기다리고 있어요/)
            .first(),
        );
    } else if (n === 20) {
      await review();
      const gate = page.waitForResponse((r) => r.url().endsWith("/candidates"));
      await click(page.locator(".pc-review .pc-primary"));
      await gate;
      await seen(page.getByText(/완료.*팀|검증.*결과|부품.*조회/).first());
    } else if (n === 21) {
      await personal();
      await click(button("움직임 멈춤"));
      await expect(button("움직임 멈춤")).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      actual = "움직임 정지 aria-pressed=true";
    } else if (n === 22) {
      await personal();
      await fill(
        page.getByRole("textbox", { name: "채팅 입력" }),
        "PC 상담 예산 300만원으로 새 PC를 구성하고 싶어요",
      );
      await click(page.getByRole("button", { name: "보내기", exact: true }));
      if (await page.locator(".transcript-history > summary").count())
        await click(page.locator(".transcript-history > summary"));
      await seen(
        page.getByText("PC 상담 예산 300만원으로 새 PC를 구성하고 싶어요", {
          exact: true,
        }),
      );
    } else if (n === 23) {
      await personal();
      await click(page.locator(".transcript-history > summary"));
      await seen(page.getByRole("list", { name: "대화 기록" }));
    } else if (n === 24) {
      await personal();
      await click(
        page.locator("summary").filter({ hasText: "음성 처리 안내" }),
      );
      await expect(
        page.locator("details").filter({ hasText: "음성 처리 안내" }),
      ).toHaveAttribute("open", "");
      actual = "음성 처리 안내 펼침";
    } else if (n === 25) {
      await personal();
      const toggle = page.getByTestId("voice-reply");
      if (await toggle.isDisabled())
        throw new Blocked(
          "이 브라우저에서 음성 합성 미지원으로 음성 답 제어 비활성",
        );
      const before = await toggle.getAttribute("aria-pressed");
      await click(toggle);
      await expect(toggle).toHaveAttribute(
        "aria-pressed",
        before === "true" ? "false" : "true",
      );
      actual = "음성 답=" + (await toggle.getAttribute("aria-pressed"));
    } else if (n === 26 || n === 27) {
      await survey(n === 26 ? "new" : "replacement");
      await seen(page.locator(".pc-survey h1"));
      expect(actual).toContain(
        n === 26 ? "어떤 PC를 만들고" : "무엇이 아쉬우세요",
      );
    } else if (n >= 28 && n <= 37) {
      await survey();
      if (n === 28) {
        await fill(page.locator("#pc-budget"), "3800000");
        await expect(page.locator("#pc-budget")).toHaveValue("3,800,000");
        actual = await page.locator("#pc-budget").inputValue();
      }
      if (n === 29) {
        await fill(page.locator("#pc-budget"), "abc");
        await expect(page.locator("#pc-budget")).toHaveValue("");
        actual = "비숫자 입력 후 공란";
      }
      if (n === 30) {
        await page.getByRole("checkbox", { name: /고사양 게임/ }).check();
        await fill(page.locator("#pc-budget"), "0");
        await click(page.locator(".pc-survey button[type=submit]"));
        await seen(page.locator("#pc-budget-error"));
      }

      if (n === 31) {
        await fill(page.locator("#pc-budget"), "1000000");
        await click(page.locator(".pc-survey button[type=submit]"));
        await seen(page.locator("#pc-purpose-error"));
      }
      if (n === 32) {
        const boxes = page
          .locator(".pc-choice-grid")
          .first()
          .getByRole("checkbox");
        await boxes.nth(0).check();
        await boxes.nth(1).check();
        expect(
          await page
            .locator(".pc-choice-grid")
            .first()
            .locator("input:checked")
            .count(),
        ).toBe(2);
        actual = "용도 2개 선택";
      }
      if (n === 33) {
        await page.getByRole("checkbox", { name: /고사양 게임/ }).check();
        await seen(page.getByText("원하는 성능", { exact: true }));
      }
      if (n === 34) {
        await select(
          page.getByRole("combobox", { name: "목표 해상도" }),
          "qhd",
        );
        await expect(
          page.getByRole("combobox", { name: "목표 해상도" }),
        ).toHaveValue("qhd");
        actual = "해상도 qhd";
      }
      if (n === 35) {
        await click(button("설문 창 접기"));
        await expect(page.locator(".pc-survey")).not.toBeVisible();
        actual = "설문 접힘";
      }
      if (n === 36) {
        await fill(page.locator("#pc-budget"), "3800000");
        await click(button("설문 창 접기"));
        await click(
          page.getByRole("button", { name: /설문 계속 작성|설문 확인하기/ }),
        );
        await expect(page.locator("#pc-budget")).toHaveValue("3,800,000");
        actual = "예산 3,800,000 유지";
      }
      if (n === 37) {
        await click(button("크게 보기"));
        await expect(button("기본 크기")).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        actual = "확대 상태 aria-pressed=true";
      }
    } else if (n >= 38 && n <= 42) {
      await review();
      if (n === 38) {
        await seen(page.locator(".pc-review"));
        expect(actual).toContain("신규 PC 조립");
      }
      if (n === 39) {
        await seen(page.locator(".pc-review"));
        expect(actual).toContain("3,800,000");
      }
      if (n === 40) {
        await seen(page.locator(".pc-review"));
        expect(actual).toContain("고사양 게임");
      }
      if (n === 41) {
        await click(button("입력 내용 고치기"));
        await seen(page.locator(".pc-survey"));
      }
      if (n === 42) {
        await page.route("**/plan", async (route) => {
          await new Promise((r) => setTimeout(r, 900));
          await route.continue();
        });
        await click(page.locator(".pc-review .pc-primary"));
        await seen(page.getByText(/상담 준비 중/));
      }
    } else if (n >= 43 && n <= 48) {
      const data = await candidates(true);
      if (n === 43) {
        const item = data.passed[0] ?? data.needsReview[0];
        if (!item) throw new Blocked("후보 0건");
        if (!data.passed.length)
          await click(page.locator(".pc-unknown > summary"));
        await seen(
          page.getByRole("heading", { name: item.part.name, exact: true }),
        );
      }
      if (n === 44) {
        const item = data.passed[0] ?? data.needsReview[0];
        if (!item) throw new Blocked("후보 0건");
        if (!data.passed.length)
          await click(page.locator(".pc-unknown > summary"));
        const card = page
          .getByTestId("pc-candidate")
          .filter({
            has: page.getByRole("heading", {
              name: item.part.name,
              exact: true,
            }),
          })
          .first();
        await seen(card);
        expect(actual).toContain(
          item.part.current_price.toLocaleString("ko-KR"),
        );
      }
      if (n === 45) {
        await seen(page.locator("[aria-current=step]").last());
        expect(actual).toContain("CPU");
      }
      if (n === 46) {
        const more = page
          .getByRole("button", { name: /후보.*더 보기|더 보기/ })
          .first();
        if (!(await more.count()))
          throw new Blocked(
            "현재 후보 수가 기본 표시 건수 이하라 더 보기 버튼이 없음",
          );
        const before = await page.getByTestId("pc-candidate").count();
        await click(more);
        const after = await page.getByTestId("pc-candidate").count();
        expect(after).toBeGreaterThan(before);
        expect(after - before).toBeLessThanOrEqual(10);
        actual = "후보 " + before + "→" + after;
      }
      if (n === 47) {
        await click(
          page.locator("summary").filter({ hasText: "후보에 적용한 기준" }),
        );
        await seen(
          page.locator("details").filter({ hasText: "후보에 적용한 기준" }),
        );
      }
      if (n === 48) {
        const reviewed = await reviewCandidates();
        if (!reviewed.needsReview.length)
          throw new Blocked("8개 분류를 확인했으나 확인 필요 후보 0건");
        const d = page.locator(".pc-unknown");
        if ((await d.getAttribute("open")) === null)
          await click(d.locator("summary").first());
        await seen(d.getByTestId("pc-candidate").first());
      }
    } else if (n >= 49 && n <= 51) {
      const item = await unknownDialog();
      if (n === 49) {
        await seen(page.getByRole("dialog"));
        expect(actual).toContain("확인하지 못한 항목");
      }
      if (n === 50) {
        await click(button("다른 후보 보기"));
        await expect(page.getByRole("dialog")).not.toBeVisible();
        actual = "주의사항 창 닫힘";
      }
      if (n === 51) {
        const next = page.waitForResponse((r) =>
          r.url().endsWith("/candidates"),
        );
        await click(button("주의사항을 확인하고 선택"));
        const r = await next;
        const data = await r.json();
        expect(r.request().postDataJSON().selected[item.part.category]).toBe(
          item.part.part_id,
        );
        actual = "선택 반영 " + item.part.category + "=" + item.part.part_id;
      }
    } else if (n === 52) {
      const data = await candidates(true);
      await chooseCandidate(data);
      await click(page.getByRole("button", { name: /이전 단계/ }));
      await seen(page.getByText(/CPU 후보/).first());
    } else if (n >= 53 && n <= 58) {
      if (n === 53) {
        await owned();
        await seen(page.locator("#pc-search-cpu"));
      }
      if (n === 54) {
        const data = await ownedSearch();
        expect(data.length).toBeGreaterThan(0);
        await seen(page.getByRole("list", { name: "CPU 검색 결과" }));
      }
      if (n === 55) {
        const data = await ownedSearch("Intel");
        if (data.length <= 15)
          throw new Blocked(
            "검색 API 결과가 15개 이하여서 초과 절단 조건 미충족",
          );
        expect(
          await page
            .getByRole("list", { name: "CPU 검색 결과" })
            .locator("li")
            .count(),
        ).toBeLessThanOrEqual(15);
        actual = "화면 결과 최대 15개";
      }
      if (n === 56) {
        const data = await ownedSearch();
        if (!data.length) throw new Blocked("검색 결과 0건");
        await click(
          page
            .getByRole("list", { name: "CPU 검색 결과" })
            .getByRole("button")
            .first(),
        );
        await expect(
          page.locator(".pc-owned summary").filter({ hasText: "CPU" }),
        ).toContainText(data[0].name);
        actual = "선택 CPU=" + data[0].name;
      }
      if (n === 57) {
        await manualCPU();
        await expect(
          page.locator(".pc-owned summary").filter({ hasText: "CPU" }),
        ).toContainText("QA 보유 CPU");
        actual = "직접 입력 CPU 반영";
      }
      if (n === 58) {
        await manualCPU();
        await click(
          page.locator(".pc-owned summary").filter({ hasText: "CPU" }),
        );
        await click(page.getByRole("button", { name: /선택 해제/ }));
        await expect(
          page.locator(".pc-owned summary").filter({ hasText: "CPU" }),
        ).not.toContainText("QA 보유 CPU");
        actual = "CPU 선택 해제";
      }
    } else if (n === 59) {
      await validSurvey("replacement");
      await page
        .getByRole("checkbox", { name: "저장 공간이 부족해요" })
        .check();
      await click(page.locator(".pc-survey button[type=submit]"));
      await seen(page.locator("#pc-owned-error"));
    } else if (n === 60) {
      await manualCPU();
      await click(page.locator(".pc-survey button[type=submit]"));
      await seen(page.locator("#pc-problem-error"));
    } else if (n >= 61 && n <= 66) {
      if (n === 61) {
        await budget();
        await seen(page.locator(".pc-budget-screen"));
      }
      if (n === 62) {
        await budget();
        await fill(page.getByRole("textbox", { name: "이 부품 예산" }), "0");
        await click(button("새 후보와 배분 확인"));
        await seen(page.getByRole("alert"));
      }
      if (n >= 63) {
        const data = await budget(true);
        if (!data.alternatives?.length && n !== 65)
          throw new Blocked(
            "현재 DB 응답의 대체 제안이 0건이라 대체 조건 미충족",
          );
        if (n === 63) await seen(page.locator(".pc-alternative").first());
        if (n === 64) {
          const next = page.waitForResponse((r) =>
            r.url().endsWith("/candidates"),
          );
          await click(button("거절하고 기존 구성 유지"));
          const r = await next;
          expect(
            r.request().postDataJSON().selected[data.__original.category],
          ).toBe(data.__original.id);
          actual = "미리보기 뒤 기존 선택 ID 유지=" + data.__original.id;
        }
        if (n === 65) {
          const next = page.waitForResponse((r) =>
            r.url().endsWith("/candidates"),
          );
          await click(button("거절하고 기존 구성 유지"));
          const r = await next;
          expect(
            r.request().postDataJSON().selected[data.__original.category],
          ).toBe(data.__original.id);
          actual = "거절 뒤 기존 선택 ID=" + data.__original.id;
        }
        if (n === 66) {
          const next = page.waitForResponse((r) =>
            r.url().endsWith("/candidates"),
          );
          await click(button("대체안과 배분 적용"));
          const r = await next;
          const a = data.alternatives[0];
          expect(r.request().postDataJSON().selected[a.category]).toBe(
            a.after.part_id,
          );
          actual = "적용한 대체 ID=" + a.after.part_id;
        }
      }
    } else if (n >= 67) {
      let quote = await quotation();
      if (n === 67) {
        expect(quote.items.length).toBe(8);
        await expect(page.locator(".pc-quote-screen")).toContainText(
          "총 8개 부품",
        );
        actual = "견적 항목 8개";
      }
      if (n === 68)
        await seen(
          page
            .locator(".pc-quote-screen")
            .getByText(/테스트 가격/)
            .first(),
        );
      if (n === 69) await seen(page.getByRole("button", { name: /^v1/ }));
      if (n >= 70 && n <= 74) {
        if (n === 74) {
          if ((await page.locator(".pc-history-item").count()) < 2)
            throw new Blocked(
              "현재 세션에 견적 버전이 1개뿐이라 과거 조회 조건 없음",
            );
          await click(page.locator(".pc-history-item").first());
          await seen(
            page
              .locator(".pc-quote-screen")
              .getByText(/견적 v1/)
              .first(),
          );
          return;
        }
        await click(
          page.getByRole("button", { name: "CPU 변경 요청", exact: true }),
        );
        if (n === 70) {
          await seen(page.getByRole("dialog"));
          expect(actual).toContain("CPU 변경 요청");
        }
        if (n === 71) {
          await click(button("취소"));
          await expect(page.getByRole("dialog")).not.toBeVisible();
          actual = "변경 요청 창 닫힘";
        }
        if (n === 72) {
          const input = page.getByRole("textbox", { name: "바라는 조건" });
          await fill(input, "a".repeat(501));
          expect((await input.inputValue()).length).toBeLessThanOrEqual(500);
          actual = "메모 길이=" + (await input.inputValue()).length;
        }
        if (n === 73) {
          const next = page.waitForResponse(
            (r) => r.url().endsWith("/candidates"),
            { timeout: 30000 },
          );
          await click(button("설계팀에 변경 요청"));
          const data = await (await next).json();
          quote = await chooseCandidate(data, "/quotes");
          cachedQuote = { page, data: quote };
          await expect(page.locator(".pc-quote-screen")).toContainText(
            "견적 v2",
          );
          actual = "견적 v" + quote.version;
        }
      }
      if (n === 75) {
        if (quote.validation.status !== "FAIL")
          throw new Blocked(
            "현재 실제 견적 판정 " +
              quote.validation.status +
              "이며 FAIL 견적 선행 조건 미충족",
          );
        await expect(button("이 견적으로 확정")).toBeDisabled();
        actual = "FAIL 견적 확정 비활성";
      }
      if (n === 76 || n === 77) {
        const confirm = button("이 견적으로 확정");
        if (await confirm.isDisabled())
          throw new Blocked(
            "실제 견적의 승인 진입이 비활성: " +
              (await page.locator(".pc-quote-checks").innerText()),
          );
        await click(confirm);
        const consent = page.getByRole("checkbox", {
          name: /조건부 또는 확인 불가/,
        });
        if (!(await consent.count()))
          throw new Blocked("조건부 동의가 필요한 견적이 아님");
        if (n === 77) await consent.check();
        await expect(button("확인하고 견적 승인"))[
          n === 76 ? "toBeDisabled" : "toBeEnabled"
        ]();
        actual = "동의=" + (n === 77) + ", 승인 버튼 확인";
      }
      if (n === 78) {
        await click(button("인쇄 · PDF 저장"));
        throw new Blocked(
          "인쇄 버튼 호출 완료. Playwright 페이지 범위에서 브라우저/OS 인쇄 대화상자 가시성을 확인할 수 없어 수동 확인 필요",
        );
      }
    }
  });

const fault = (message) => async (route) =>
  route.fulfill({ status: 503, json: { detail: message } });
async function enterFault(pattern, message) {
  await start("personal");
  await page.route(pattern, fault(message));
  await click(page.getByRole("button", { name: /개인용 시연으로 시작/ }));
}
for (let n = 1; n <= 20; n++)
  def("BW-X-" + String(n).padStart(3, "0"), async () => {
    if (n === 1) {
      let edge;
      try {
        edge = await chromium.launch({ channel: "msedge", headless: true });
        const ep = await edge.newPage();
        await ep.goto(baseUrl);
        await expect(ep.locator(".entry-shell")).toBeVisible();
        actual = "Edge 계정 선택 화면 표시";
        await ep.screenshot({
          path: path.join(output, currentCase + "-edge.png"),
        });
      } catch (e) {
        if (!edge) throw new Blocked("Edge 실행 불가: " + e.message);
        throw e;
      } finally {
        if (edge) await edge.close();
      }
    } else if (n === 2) {
      await start();
      await page.reload();
      await seen(page.locator(".entry-shell"));
    } else if (n === 3) {
      await start();
      await page.locator("[name=userId]").focus();
      await page.keyboard.press("Tab");
      await expect(page.locator("#pc-password")).toBeFocused();
      actual = "Tab으로 비밀번호 입력란 이동";
    } else if (n === 4) {
      await start();
      await click(button("로그인"));
      await expect(page.locator("[name=userId]")).toHaveAttribute(
        "aria-describedby",
        "pc-login-error",
      );
      actual = "aria-describedby=pc-login-error";
    } else if (n === 5 || n === 6) {
      await enterFault("**/sessions", "QA 세션 장애");
      if (n === 5) await seen(page.getByText("QA 세션 장애", { exact: true }));
      else await seen(button("다시 시도"));
    } else if (n === 7) {
      await start("personal");
      let first = true;
      await page.route("**/sessions", async (route) => {
        if (first) {
          first = false;
          await fault("QA 최초 연결 장애")(route);
        } else await route.continue();
      });
      await click(page.getByRole("button", { name: /개인용 시연으로 시작/ }));
      await seen(button("다시 시도"));
      const r = page.waitForResponse(
        (r) => r.url().endsWith("/sessions") && r.status() === 201,
      );
      await click(button("다시 시도"));
      await r;
      actual = "재시도 실제 API 201";
    } else if (n === 8) {
      await review();
      await page.route("**/plan", fault("QA 설계 장애"));
      await click(page.locator(".pc-review .pc-primary"));
      await seen(page.getByText("QA 설계 장애", { exact: true }));
      await expect(page.locator(".pc-review .pc-primary")).toBeEnabled();
      actual = "설계 오류 표시·준비 중 종료";
    } else if (n === 9 || n === 10) {
      await review();
      let first = true;
      await page.route("**/candidates", async (route) => {
        if (first) {
          first = false;
          await fault("QA 후보 장애")(route);
        } else await route.continue();
      });
      await click(page.locator(".pc-review .pc-primary"));
      await seen(page.getByText("QA 후보 장애", { exact: true }));
      if (n === 10) {
        const r = page.waitForResponse(
          (r) => r.url().endsWith("/candidates") && r.status() === 200,
        );
        await click(button("다시 시도"));
        await r;
        await seen(page.getByTestId("pc-candidate").first());
      }
    } else if (n === 11 || n === 12) {
      const data = await candidates(true, "1");
      if (data.passed.length || data.needsReview.length)
        throw new Blocked(
          "1원 예산의 실제 API에도 후보가 존재해 0건 선행 조건 미충족",
        );
      if (n === 11)
        await seen(page.getByText(/후보가 없|후보를 찾지 못/).first());
      else {
        await click(
          page.getByRole("button", {
            name: /입력.*고치|조건.*바꾸|조건.*수정|조건 다시/,
          }),
        );
        await seen(page.locator(".pc-survey"));
      }
    } else if (n === 13) {
      await owned();
      await page.route("**/parts?*", fault("QA 부품 검색 장애"));
      await fill(page.locator("#pc-search-cpu"), "Ryzen");
      await expect(page.getByRole("alert")).toContainText("QA 부품 검색 장애");
      actual = await page.getByRole("alert").innerText();
    } else if (n === 14) {
      const data = await ownedSearch("NO_SUCH_DEVICE_169QA");
      expect(data).toHaveLength(0);
      await seen(
        page.getByText("검색 결과가 없습니다. 아래에서 직접 입력해 주세요.", {
          exact: true,
        }),
      );
    } else if (n === 15) {
      await budget();
      await page.route("**/rebalance", fault("QA 재배분 장애"));
      await click(button("새 후보와 배분 확인"));
      await seen(page.getByText("QA 재배분 장애", { exact: true }));
    } else if (n === 16) {
      await quotation();
      await click(
        page.getByRole("button", { name: "CPU 변경 요청", exact: true }),
      );
      await page.route("**/candidates", fault("QA 변경 요청 장애"));
      await click(button("설계팀에 변경 요청"));
      await seen(page.getByText("QA 변경 요청 장애", { exact: true }));
    } else if (n === 17) {
      await quotation();
      const c = button("이 견적으로 확정");
      if (await c.isDisabled())
        throw new Blocked(
          "현재 실제 견적에서 승인 진입이 비활성이라 승인 요청 중 상태를 만들 수 없음",
        );
      await click(c);
      throw new Blocked(
        "실제 승인 요청은 아직 수행하지 않음. 승인 가능한 근거·상태 확인 필요",
      );
    } else if (n === 18) {
      const q = await quotation();
      if (!q.handoff?.required)
        throw new Blocked("현재 실제 견적에 handoff.required=true 조건이 없음");
      await expect(button("이 견적으로 확정")).toBeDisabled();
      actual = "사람 인계 필수 견적·확정 비활성";
    } else if (n === 19) {
      await business("고객 정보");
      await fill(
        page.getByRole("textbox", { name: "고객 검색" }),
        "존재하지않는가상고객169QA",
      );
      await seen(
        page
          .getByText(/검색 결과가 없|일치하는 고객이 없|조건에 맞는 고객이 없/)
          .first(),
      );
    } else if (n === 20) {
      await business("기업 홈", "agent");
      await click(
        page
          .getByRole("navigation", { name: "기업 메뉴" })
          .getByRole("button", { name: /상품 · 정책/ }),
      );
      await seen(
        page.getByText("관리자만 사용할 수 있습니다.", { exact: true }),
      );
    }
  });
function save() {
  fs.writeFileSync(
    path.join(output, "results.json"),
    JSON.stringify(
      { baseUrl, scope, cases: results, actions, network },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(output, "button-log.json"),
    JSON.stringify(actions, null, 2),
  );
}
const htmlEscape = (x) =>
  String(x)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;");
process.on("unhandledRejection", (error) =>
  actions.push({
    id: currentCase,
    action: "종료된 요청 대기 오류",
    detail: String(error),
  }),
);
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
  page.setDefaultTimeout(5000);
  context.on("response", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/api/"))
      network.push({
        id: currentCase,
        path: u.pathname,
        status: r.status(),
        time: new Date().toISOString(),
      });
  });
  for (const c of selectedCatalog) {
    currentCase = c.id;
    actual = "";
    const start = Date.now();
    let result = "Pass",
      detail = "",
      screenshot = "";
    try {
      const fn = handlers.get(c.id);
      if (!fn) throw new Blocked("이 케이스의 실행 시나리오가 등록되지 않음");
      await fn();
      detail = actual || "해당 기대 결과의 Playwright 단언 충족";
    } catch (error) {
      result = error instanceof Blocked ? "Blocked" : "Fail";
      detail = error.message;
    }
    try {
      screenshot = c.id + ".png";
      await page.screenshot({
        path: path.join(output, screenshot),
        fullPage: true,
        timeout: 10000,
      });
      fs.writeFileSync(
        path.join(output, c.id + ".txt"),
        await page.locator("body").innerText(),
      );
    } catch (error) {
      screenshot = "";
      detail += "\n캡처 오류: " + error.message;
      if (result === "Pass") result = "Fail";
    }
    results.push({
      id: c.id,
      expected: c.expected,
      result,
      detail,
      screenshot,
      seconds: (Date.now() - start) / 1000,
      precondition: c.pre,
      steps: c.steps,
      sheet: c.sheet,
      row: c.row,
    });
    await page.unrouteAll({ behavior: "ignoreErrors" }).catch(() => {});
    console.log(
      result +
        " | " +
        c.id +
        " | " +
        detail.replaceAll("\n", " ").slice(0, 180),
    );
    save();
    try {
      if (await page.getByRole("dialog").count())
        await page.keyboard.press("Escape");
    } catch {}
  }
} catch (error) {
  for (const c of selectedCatalog.filter(
    (c) => !results.some((r) => r.id === c.id),
  ))
    results.push({
      id: c.id,
      expected: c.expected,
      result: "Blocked",
      detail: "브라우저 환경 오류: " + error.message,
      seconds: 0,
      sheet: c.sheet,
      row: c.row,
    });
} finally {
  save();
  if (context)
    await context.tracing
      .stop({ path: path.join(output, "trace.zip") })
      .catch(() => {});
  if (browser) await browser.close();
  const rows = results
    .map(
      (r) =>
        "<tr><td>" +
        r.id +
        "</td><td>" +
        r.result +
        "</td><td>" +
        htmlEscape(r.expected) +
        "</td><td>" +
        htmlEscape(r.detail) +
        '</td><td><a href="' +
        r.screenshot +
        '">화면</a></td></tr>',
    )
    .join("");
  fs.writeFileSync(
    path.join(output, "index.html"),
    '<!doctype html><meta charset="utf-8"><title>BUILDWISE 기능 검증 169건</title><style>body{font:15px sans-serif;margin:24px}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:8px;white-space:pre-wrap}</style><h1>미실행 기능 케이스 검증</h1><p>기대 결과는 기존 시트 기준. 기업은 시연 데이터. 성공 API 응답을 Mock으로 대체하지 않음.</p><table><tr><th>ID</th><th>결과</th><th>기대 결과</th><th>관측</th><th>캡처</th></tr>' +
      rows +
      "</table>",
  );
}
process.exitCode = results.some((r) => r.result === "Fail")
  ? 1
  : results.some((r) => r.result === "Blocked")
    ? 2
    : 0;
