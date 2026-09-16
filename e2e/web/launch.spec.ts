import { test, expect } from "@playwright/test";
const required = (key: string) => {
  const value = process.env[key];
  if (!value)
    throw new Error(
      `${key} must identify an isolated test account or fixture. See docs/launch-readiness.md.`,
    );
  return value;
};
test("missing and forged credentials cannot reach privileged operations", async ({
  request,
}) => {
  for (const token of ["", "forged.expired.token"]) {
    const response = await request.get("/api/account", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    expect(response.status()).toBe(401);
  }
});
test("sign in, browse the study library, and prevent cross-account reads", async ({
  page,
  request,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(required("E2E_EMAIL"));
  await page
    .getByLabel("Password", { exact: true })
    .fill(required("E2E_PASSWORD"));
  await page.getByRole("button", { name: /sign in/i, exact: true }).click();
  await expect(page).toHaveURL(/dashboard/, { timeout: 30000 });
  await page.goto(`/decks/${required("E2E_DECK_ID")}`);
  await expect(
    page.getByText(required("E2E_DECK_NAME"), { exact: true }).first(),
  ).toBeVisible();
  // Browser request context shares its signed-in cookies; the other account's card must be inaccessible.
  const response = await page.request.get(
    `/api/cards/${required("E2E_OTHER_CARD_ID")}`,
  );
  expect([403, 404]).toContain(response.status());
  await expect(page.getByRole("main")).toBeVisible();
});
