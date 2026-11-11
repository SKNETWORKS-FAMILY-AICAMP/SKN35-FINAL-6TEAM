import { expect, test } from "@playwright/test";

// 실제 브라우저로 한 바퀴: 상담 → 오피스 상태 → 견적 → 가상 주문 → 예산 변경 → 기업 전환
test("상담부터 가상 주문까지", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("test-data-badge")).toBeVisible();
  await expect(page.getByTestId("connection")).toContainText("실시간 연결됨");

  await page.getByTestId("purpose").fill("영상 편집");
  await page.getByTestId("budget").fill("2500000");
  await page.getByTestId("submit").click();

  await expect(page.getByTestId("run-status")).toContainText("완료", { timeout: 30_000 });
  await expect(page.getByTestId("desk-quotation")).toContainText("완료");
  await expect(page.getByTestId("quotation-total")).toContainText("2,190,000원");

  await page.getByTestId("order").click();
  await expect(page.getByTestId("order-result")).toContainText("가상 주문 완료");

  // 예산을 올리면 최신 요구사항(v2) 기준으로 다시 그립니다.
  await page.getByTestId("budget").fill("4000000");
  await page.getByTestId("submit").click();
  await expect(page.getByTestId("run-status")).toContainText("요구사항 v2");
  await expect(page.getByTestId("run-status")).toContainText("완료", { timeout: 30_000 });
  await expect(page.getByTestId("quotation-total")).toContainText("3,390,000원");

  // 같은 엔진, 다른 기업(카탈로그 · 정책)
  await page.getByTestId("company").selectOption({ label: "가상 기업 A (컴퓨터 전문점)" });
  await expect(page.getByTestId("connection")).toContainText("실시간 연결됨");
  await page.getByTestId("budget").fill("2500000");
  await page.getByTestId("submit").click();
  await expect(page.getByTestId("run-status")).toContainText("완료", { timeout: 30_000 });
  await expect(page.getByTestId("quotation-total")).toContainText("1,930,300원");
});
