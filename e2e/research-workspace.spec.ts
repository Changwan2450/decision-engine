import { expect, test } from "@playwright/test";

test("project -> run -> execute -> decision -> insights -> promotion", async ({
  page
}) => {
  await page.goto("/");

  await page.getByLabel("name").fill("E2E Project");
  await page.getByLabel("description").fill("시장조사 E2E");
  await page.getByRole("button", { name: "프로젝트 만들기" }).click();

  await expect(page.getByRole("heading", { name: "E2E Project" })).toBeVisible();

  await page.getByRole("link", { name: "새 런 만들기" }).click();
  await page.getByLabel("title").fill("숏츠 시장 진입");
  await page.getByLabel("natural language").fill(
    "목표: 숏츠 시장 진입 여부 판단\n대상: 20대 크리에이터\n비교: 쇼츠 vs 릴스"
  );
  await page.getByLabel("pasted content").fill("경쟁사 패턴과 반복 문제를 봐야 함");
  await page.getByLabel("urls").fill("https://example.com/source");
  await page.getByRole("button", { name: "런 만들기" }).click();

  await expect(page.getByRole("heading", { name: "숏츠 시장 진입" })).toBeVisible();

  await page.getByRole("button", { name: "리서치 실행" }).click();

  await expect(page.getByRole("heading", { name: "go" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Claim-based evidence" })).toBeVisible();

  await page.getByRole("link", { name: "프로젝트로" }).click();

  await expect(page.getByRole("heading", { name: "프로젝트 공통 인사이트" })).toBeVisible();
  await expect(page.getByText("차별화가 어렵다")).toBeVisible();
  await expect(page.getByRole("heading", { name: "승격 추천 상태" })).toBeVisible();
});
