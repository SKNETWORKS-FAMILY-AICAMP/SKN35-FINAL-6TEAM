import { expect, test, type Page } from "@playwright/test";

// 시연 데이터 모드(?demo)는 서버 없이 돕니다. 예산만 바꾸고 매 단계 AI 추천만 눌러 결제까지 가는지 봅니다.
async function buildWithRecommendations(page: Page, budget: string, company?: string) {
  await page.goto("/?demo");
  await page.getByRole("button", { name: "개인" }).first().click();
  await page.getByRole("button", { name: "개인용 시연으로 시작" }).click();
  if (company) await page.getByLabel("상담 기업").selectOption(company);
  await page.locator(".pc-type-new").click();
  await page.locator("#pc-budget").fill(budget);
  await page.getByRole("checkbox", { name: /고사양 게임/ }).check();
  await page.locator(".pc-survey button[type=submit]").click();
  await page.locator(".pc-review .pc-primary").click();

  const recommended = page.locator(".pc-candidate.pc-recommended").getByRole("button", {
    name: /선택/,
  });
  const cooling = page.getByRole("group", { name: "CPU 냉각 방식" });
  const confirm = page.getByRole("button", { name: "이 견적으로 확정" });
  for (let step = 0; step < 8; step++) {
    await expect(recommended.or(cooling).first()).toBeVisible({ timeout: 60_000 });
    if (await cooling.isVisible())
      await page.getByRole("button", { name: "다음", exact: true }).click();
    else await recommended.click();
  }
  await expect(confirm).toBeEnabled({ timeout: 60_000 });
  await confirm.click();
  const consent = page.getByRole("dialog").getByRole("checkbox");
  if (await consent.isVisible()) await consent.check();
  await page.getByRole("button", { name: "확인하고 견적 승인" }).click();
  await expect(page.getByRole("heading", { name: "선택하신 견적을 승인했어요." })).toBeVisible();
  await page.getByRole("button", { name: /결제 화면으로 이동/ }).click();
  await page.getByRole("button", { name: "결제하기", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "결제가 되었습니다." })).toBeVisible();
}

test.describe("시연 데이터 신규 조립", () => {
  test.setTimeout(240_000);

  test("가상전자: 예산만 넣고 AI 추천만 눌러 결제까지 간다", async ({ page }) => {
    await buildWithRecommendations(page, "1500000");
  });

  test("테스트컴퓨터: 같은 순서로 결제까지 간다", async ({ page }) => {
    await buildWithRecommendations(page, "1500000", "BW-2002");
  });
});
