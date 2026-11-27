import { expect, test } from "@playwright/test";
import { fixtureParts } from "../src/features/pc-consult/fixtures/demoSnapshot.fixture";

test("설계 중 예산과 CPU를 바꾸면 새 CPU로 보드를 조회하고 초안까지만 만든다", async ({ page }) => {
  // Isolated transport fixture. The browser uses the normal chat, selection and quote screens.
  const cpu = (brand: string) =>
    fixtureParts.find((p) => p.category === "cpu" && p.brand === brand)!;
  const amd = cpu("AMD"),
    intel = cpu("Intel");
  const boards = fixtureParts.filter((p) => p.category === "motherboard");
  const amdBoard = { ...boards[0], name: "테스트 AMD용 보드" };
  const intelBoard = { ...boards[1], name: "테스트 Intel용 보드" };
  const storage = fixtureParts.find((p) => p.category === "storage")!;
  const validation = { status: "PASS", checks: [], basis: "api" };
  const budgets: number[] = [];
  const boardInputs: number[] = [];
  const quotes: Array<{ cpu: number; motherboard: number }> = [];
  const messages: Array<{ id: number; role: string; content: string; created_at: string }> = [];
  let confirmed = false;
  await page.route("**/api/pc-consult/sessions**", async (route) => {
    const path = new URL(route.request().url()).pathname.split("/").at(-1);
    const body = route.request().postDataJSON();
    switch (path) {
      case "sessions":
        return route.fulfill({ json: { session_id: "revision-test" } });
      case "stream":
        return route.fulfill({ contentType: "text/event-stream", body: ": test\n\n" });
      case "messages": {
        if (!body) return route.fulfill({ json: messages });
        const pair = [
          ["user", body.text],
          ["assistant", "테스트 요청 접수"],
        ];
        for (const [role, content] of pair)
          messages.push({
            id: messages.length + 1,
            role,
            content,
            created_at: new Date().toISOString(),
          });
        return route.fulfill({ json: { text: "테스트 요청 접수", sources: [], messages } });
      }
      case "plan":
        budgets.push(body.survey.budget);
        return route.fulfill({
          json: {
            steps: ["cpu", "motherboard", "storage"],
            reasons: {},
            criteria: [],
            allocations: {
              cpu: body.survey.budget / 2,
              motherboard: body.survey.budget / 4,
              storage: body.survey.budget / 4,
            },
          },
        });
      case "candidates": {
        if (body.category === "motherboard") boardInputs.push(body.selected.cpu);
        const byCategory = {
          cpu: [amd, intel],
          motherboard: [body.selected.cpu === intel.part_id ? intelBoard : amdBoard],
          storage: [storage],
        };
        const parts = byCategory[body.category as keyof typeof byCategory];
        return route.fulfill({
          json: {
            basis: "api",
            passed: parts.map((part, i) => ({
              part,
              validation,
              recommended: i === 0,
              reason: "테스트 후보",
            })),
            needsReview: [],
            rejectedCount: 0,
            missingColorCount: 0,
            criteria: [],
            sortLabel: "테스트 순서",
          },
        });
      }
      case "quotes": {
        quotes.push(body.selected);
        const parts =
          body.selected.cpu === intel.part_id
            ? [intel, intelBoard, storage]
            : [amd, amdBoard, storage];
        return route.fulfill({
          json: {
            quote_id: String(quotes.length),
            consultation_id: "revision-test",
            version: body.version,
            created_at: new Date().toISOString(),
            currency: "KRW",
            status: "DRAFT",
            validation,
            total_amount: parts.reduce((total, p) => total + p.current_price!, 0),
            items: parts.map((p) => ({
              part_id: p.part_id,
              source_key: p.source_key,
              category: p.category,
              part_name_snapshot: p.name,
              unit_price: p.current_price,
              quantity: 1,
              price_checked_at: p.price_checked_at,
            })),
          },
        });
      }
      case "confirm":
        confirmed = true;
        break;
    }
    return route.abort();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "개인용", exact: true }).click();
  await page.getByRole("button", { name: "개인용 시연으로 시작" }).click();
  await page.locator(".pc-type-new").click();
  await page.locator("#pc-budget").fill("2000000");
  await page.getByRole("checkbox", { name: /고사양 게임/ }).check();
  await page.locator(".pc-survey button[type=submit]").click();
  await page.locator(".pc-review .pc-primary").click();
  await page.getByRole("button", { name: amd.name + " 선택", exact: true }).click();
  await page.getByRole("button", { name: amdBoard.name + " 선택", exact: true }).click();
  await expect(page.getByRole("heading", { name: storage.name, exact: true })).toBeVisible();
  await page.getByTestId("chat-input").fill("CPU를 AMD에서 인텔로 바꾸고 싶어");
  await page.getByTestId("chat-send").click();
  await expect(page.locator(".pc-quote-table")).toContainText(intel.name);
  await page
    .getByTestId("chat-input")
    .fill("나 엄마한테 용돈 받아서 예산이 600만원이 되었어 다시 견적 짜줘");
  await page.getByTestId("chat-send").click();
  await expect.poll(() => quotes.length).toBe(2);
  await expect(page.locator(".pc-quote-table")).toContainText(intel.name);
  expect(budgets).toEqual([2_000_000, 2_000_000, 6_000_000]);
  expect(boardInputs).toContain(amd.part_id);
  expect(boardInputs.at(-1)).toBe(intel.part_id);
  expect(quotes).toEqual(
    Array(2).fill({
      cpu: intel.part_id,
      motherboard: intelBoard.part_id,
      storage: storage.part_id,
    }),
  );
  expect(confirmed).toBe(false);
});
