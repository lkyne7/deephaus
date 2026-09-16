import { test, expect } from "@playwright/test";
import { signIn, createCard, browse } from "./fixtures";

test.skip(Boolean(process.env.NEXT_PUBLIC_POWERSYNC_URL), 'Run the remote-save failure gate with LAUNCH_NETWORK_ONLY=1; initialized PowerSync saves locally.');

test("failed drafts survive a closed page and can be retried", async ({
  page,
  context,
}) => {
  await signIn(page);
  const label = `Launch draft ${crypto.randomUUID()}`;
  const id = await createCard(page, label);
  const url = `**/api/cards/${id}`;
  let currentPage = page;
  await context.route(url, (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Simulated save interruption" }),
        })
      : route.continue(),
  );
  try {
    await browse(page, label);
    await page
      .getByRole("textbox", { name: "Front", exact: true })
      .fill(`${label} recovered`);
    await expect(
      page.getByRole("button", { name: "Retry save" }),
    ).toBeVisible();
    await page.close();
    currentPage = await context.newPage();
    await browse(currentPage, label);
    await expect(
      currentPage.getByRole("textbox", { name: "Front", exact: true }),
    ).toContainText("recovered");
    await expect(
      currentPage.getByRole("button", { name: "Retry save" }),
    ).toBeVisible();
    await context.unroute(url);
    await currentPage.getByRole("button", { name: "Retry save" }).click();
    await expect(
      currentPage.getByRole("status").filter({ hasText: "Saved" }),
    ).toBeVisible();
    const saved = await currentPage.request.get(`/api/cards/${id}`);
    expect((await saved.json()).front).toContain("recovered");
  } finally {
    await context.unroute(url);
    await currentPage.goto("/dashboard");
    expect(
      (await currentPage.request.delete(`/api/cards/${id}`)).ok(),
    ).toBeTruthy();
  }
});

test("slow saves remain ordered while typing and switching cards", async ({
  page,
  context,
}) => {
  await signIn(page);
  const label = `Launch ordering ${crypto.randomUUID()}`;
  const id = await createCard(page, label);
  const nextId = await createCard(page, `${label} second`);
  let entered!: () => void;
  const firstStarted = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let concurrent = 0,
    maximum = 0,
    requests = 0;
  const url = `**/api/cards/${id}`;
  await context.route(url, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    concurrent++;
    maximum = Math.max(maximum, concurrent);
    if (++requests === 1) {
      entered();
      await held;
    }
    try {
      await route.fulfill({ response: await route.fetch() });
    } finally {
      concurrent--;
    }
  });
  try {
    await browse(page, label);
    await page
      .getByRole("row")
      .filter({ hasText: label })
      .filter({ hasNotText: "second" })
      .first()
      .click();
    const front = page.getByRole("textbox", { name: "Front", exact: true });
    await front.fill(`${label} first edit`);
    await firstStarted;
    await front.fill(`${label} latest edit`);
    await page
      .getByRole("row")
      .filter({ hasText: `${label} second` })
      .first()
      .click();
    // Hold the first response beyond the autosave debounce to expose overlap.
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    release();
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`/api/cards/${id}`)).json()).front,
      )
      .toContain("latest edit");
    expect(maximum).toBe(1);
  } finally {
    release();
    await context.unrouteAll({ behavior: "wait" });
    await page.goto("/dashboard");
    for (const cardId of [id, nextId])
      expect(
        (await page.request.delete(`/api/cards/${cardId}`)).ok(),
      ).toBeTruthy();
  }
});
