import { expect, test, type Page } from "@playwright/test";

async function enterPersonal(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "개인용", exact: true }).click();
  await page.getByRole("button", { name: "개인용 시연으로 시작" }).click();
}

test("기업 계정이 연결되지 않으면 고객과 판매 데이터가 노출되지 않는다", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /기업.*AI 고객센터/ }).click();
  await expect(
    page.getByRole("navigation", { name: "판매자 메뉴" }).getByRole("button"),
  ).toHaveCount(7);
  await page.getByRole("button", { name: "고객 정보" }).click();
  await expect(page.getByRole("table")).toContainText("기업 계정과 연결한 뒤");
  await page.getByRole("button", { name: "시작 화면" }).click();
  await expect(page.getByRole("heading", { name: "어디에서 시작할까요?" })).toBeVisible();
});

test("상담 서버 오류를 알리고 재시도를 제공한다", async ({ page }) => {
  // 의도적으로 네트워크 장애를 주입한다. 제품의 성공 응답은 대체하지 않는다.
  await page.route("**/api/pc-consult/sessions", (route) =>
    route.fulfill({ status: 503, json: { detail: "상담 연결을 확인해 주세요." } }),
  );
  await enterPersonal(page);
  await expect(page.getByRole("alert")).toContainText("상담 연결을 확인해 주세요.");
  await expect(page.getByRole("button", { name: "다시 시도" })).toBeVisible();
  await expect(page.getByTestId("pc-candidate")).toHaveCount(0);
});

test("신규 조립 여덟 부품을 선택해 DB 가격과 RAG 근거가 있는 견적을 받는다", async ({ page }) => {
  const retired: string[] = [];
  page.on("request", (request) => {
    if (/\/demo-data\/|:8017\//.test(request.url())) retired.push(request.url());
  });
  await enterPersonal(page);
  await page.locator(".pc-type-new").click();
  await page.locator("#pc-budget").fill("3800000");
  await page.getByRole("checkbox", { name: /고사양 게임/ }).check();
  await page.locator(".pc-survey button[type=submit]").click();
  test.setTimeout(120_000);
  let next = page.waitForResponse((response) => response.url().endsWith("/candidates"));
  await page.locator(".pc-review .pc-primary").click();
  const selected: number[] = [];
  let total = 0;
  for (let index = 0; index < 8; index++) {
    const response = await next;
    expect(response.status()).toBe(200);
    const result = await response.json();
    const candidate = result.passed[0] ?? result.needsReview[0];
    expect(candidate.part.part_id).toBeGreaterThan(0);
    selected.push(candidate.part.part_id);
    total += candidate.part.current_price;
    if (!result.passed.length) {
      const review = page.locator(".pc-unknown");
      if ((await review.getAttribute("open")) === null)
        await review.locator("summary").first().click();
    }
    const endpoint = index === 7 ? "/quotes" : "/candidates";
    next = page.waitForResponse((res) => res.url().endsWith(endpoint));
    if (candidate.part.category === "cooler" && result.passed.length) {
      const cooling = page.getByRole("group", { name: "CPU 냉각 방식" });
      await cooling.getByRole("radio").first().check();
      if (result.fans.length) {
        const fan = result.fans[0];
        const count = page.getByRole("spinbutton", { name: fan.name + " 수량" });
        await count.fill("2");
        await expect(cooling).toBeVisible();
        selected.push(fan.part_id);
        total += fan.current_price * 2;
      }
      await page.getByRole("button", { name: "다음", exact: true }).click();
      continue;
    }
    const card = page
      .getByTestId("pc-candidate")
      .filter({ has: page.getByRole("heading", { name: candidate.part.name, exact: true }) })
      .first();
    await card.getByRole("button", { name: /선택/ }).click();
    if (!result.passed.length)
      await page.getByRole("button", { name: "주의사항을 확인하고 선택" }).click();
  }
  const response = await next;
  expect(response.status()).toBe(200);
  const quote = await response.json();
  expect(quote.items.map((item: { part_id: number }) => item.part_id).sort()).toEqual(
    selected.sort(),
  );
  expect(quote.total_amount).toBe(total);
  expect(quote.validation.citations.length).toBeGreaterThan(0);
  await expect(page.locator(".pc-quote-screen")).toContainText("견적 v1");
  await page.getByRole("button", { name: "이 견적으로 확정" }).click();
  if (quote.validation.status !== "PASS")
    await page.getByRole("dialog").getByRole("checkbox").check();
  await page.getByRole("button", { name: "확인하고 견적 승인" }).click();
  await page.getByRole("button", { name: "결제하기", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "결제가 되었습니다." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "어떤 PC가 필요하세요?" })).toBeVisible();
  expect(retired).toEqual([]);
});

test("보유 CPU를 Ryzen으로 검색하고 교체 부품의 DB 가격으로 견적을 받는다", async ({ page }) => {
  await enterPersonal(page);
  await page.getByRole("button", { name: /기존 PC 부품 교체/ }).click();
  await page.locator("#pc-budget").fill("800000");
  await page.getByRole("checkbox", { name: /고사양 게임/ }).check();
  await page.locator(".pc-owned summary").filter({ hasText: "CPU" }).click();
  const search = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith("/parts") && url.searchParams.get("query") === "Ryzen 5 7600X";
  });
  await page.locator("#pc-search-cpu").fill("Ryzen 5 7600X");
  const matches = await search;
  expect(matches.status()).toBe(200);
  const [cpu] = await matches.json();
  expect(cpu.name).toMatch(/Ryzen/i);
  expect(cpu.part_id).toBeGreaterThan(0);
  await page
    .getByRole("list", { name: "CPU 검색 결과" })
    .getByText(`${cpu.brand} ${cpu.name}`, { exact: true })
    .first()
    .click();
  // Verify the upgrade against the customer's current capacity and board interface.
  for (const [category, label, query] of [
    ["motherboard", "메인보드", "TUF GAMING B850-PLUS WIFI"],
    ["storage", "저장장치", "Orico Y-20"],
  ]) {
    await page.locator(".pc-owned summary").filter({ hasText: label }).click();
    await page.locator(`#pc-search-${category}`).fill(query);
    await page
      .getByRole("list", { name: `${label} 검색 결과` })
      .getByRole("button", { name: new RegExp(query.replaceAll("+", "\\+"), "i") })
      .first()
      .click();
  }
  await page.getByRole("checkbox", { name: "저장 공간이 부족해요" }).check();
  await page.locator(".pc-survey button[type=submit]").click();
  const candidates = page.waitForResponse((response) => response.url().endsWith("/candidates"));
  await page.locator(".pc-review .pc-primary").click();
  const response = await candidates;
  expect(response.status()).toBe(200);
  expect(response.request().postDataJSON().survey.owned.cpu.part_id).toBe(cpu.part_id);
  const list = await response.json();
  if (!list.passed.length) await page.locator(".pc-unknown > summary").click();
  const chosen = list.passed[0] ?? list.needsReview[0];
  const quote = page.waitForResponse((res) => res.url().endsWith("/quotes"));
  await page
    .getByTestId("pc-candidate")
    .filter({ has: page.getByRole("heading", { name: chosen.part.name, exact: true }) })
    .first()
    .getByRole("button", { name: /선택/ })
    .click();
  if (!list.passed.length)
    await page.getByRole("button", { name: "주의사항을 확인하고 선택" }).click();
  const result = await quote;
  expect(result.status()).toBe(200);
  const draft = await result.json();
  expect(draft.items.map((item: { part_id: number }) => item.part_id)).toEqual([
    chosen.part.part_id,
  ]);
  expect(draft.total_amount).toBe(chosen.part.current_price);
  const quotation = page.getByRole("region", { name: "참고 견적" });
  await expect(quotation.getByRole("table")).toContainText(chosen.part.name);
  await expect(quotation.locator(".pc-quote-total strong")).toHaveText(
    `₩${chosen.part.current_price.toLocaleString("ko-KR")}`,
  );
});
