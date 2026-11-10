import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./fixtures";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Day buttons are named "<Day> review load: <Level>. Change to <Next>." */
function dayButton(page: Page, day: string) {
  return page.getByRole("button", { name: new RegExp(`^${day} review load:`) });
}

async function expectDay(page: Page, day: string, level: "Normal" | "Reduced" | "Minimum") {
  await expect(dayButton(page, day)).toHaveAccessibleName(
    new RegExp(`^${day} review load: ${level}\\.`),
  );
}

test("Easy Days saves custom days and weekend preset, survives reload, and validates input", async ({
  page,
  request,
}, testInfo) => {
  expect(
    (
      await request.patch("/api/fsrs/settings", {
        data: { easyDays: Array(7).fill("normal") },
      })
    ).status(),
  ).toBe(401);
  await signIn(page);
  const original = await (await page.request.get("/api/fsrs/settings")).json();
  const normal = Array(7).fill("normal");
  try {
    expect(
      (
        await page.request.patch("/api/fsrs/settings", {
          data: { easyDays: normal },
        })
      ).ok(),
    ).toBeTruthy();
    // Old links still land on the Study settings page.
    await page.goto("/dashboard?settings=study");
    await expect(page).toHaveURL(/\/settings\/study/);
    const save = async () => {
      const completed = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/fsrs/settings") &&
          response.request().method() === "PATCH",
      );
      await page.getByRole("button", { name: "Save", exact: true }).click();
      expect((await completed).ok()).toBeTruthy();
      await expect(page.getByRole("button", { name: "Saving…", exact: true })).toBeHidden();
    };
    const weekend = page.getByRole("button", {
      name: "Weekend warrior",
      exact: true,
    });
    await weekend.click();
    await expectDay(page, "Saturday", "Reduced");
    await expectDay(page, "Sunday", "Reduced");
    await expectDay(page, "Monday", "Normal");
    await save();
    const easyDays = page.getByRole("group", {
      name: "Easy Days",
      exact: true,
    });
    await easyDays.screenshot({
      path: testInfo.outputPath("easy-days-desktop.png"),
    });
    await page.reload();
    await expect(weekend).toHaveAttribute("aria-pressed", "true");
    // Each click steps a day lighter: Normal → Reduced → Minimum.
    await dayButton(page, "Wednesday").click();
    await dayButton(page, "Wednesday").click();
    await expectDay(page, "Wednesday", "Minimum");
    await save();
    const saved = await (await page.request.get("/api/fsrs/settings")).json();
    expect(saved.easyDays).toEqual([
      "normal",
      "normal",
      "minimum",
      "normal",
      "normal",
      "reduced",
      "reduced",
    ]);
    for (const invalid of [
      [],
      Array(7).fill("minimum"),
      ["bad", ...normal.slice(1)],
    ]) {
      expect(
        (
          await page.request.patch("/api/fsrs/settings", {
            data: { easyDays: invalid },
          })
        ).status(),
      ).toBe(400);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await easyDays.scrollIntoViewIfNeeded();
    const bounds = await easyDays.boundingBox();
    expect(bounds?.x).toBeGreaterThanOrEqual(0);
    expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(390);
    // Every day's label fits inside its own button, so none run into a neighbour.
    for (const day of DAYS) {
      const fits = await dayButton(page, day).evaluate((button) =>
        Array.from(button.children).every((child) => {
          const inner = child.getBoundingClientRect();
          const outer = button.getBoundingClientRect();
          return (
            inner.left >= outer.left - 0.5 &&
            inner.right <= outer.right + 0.5 &&
            (child as HTMLElement).scrollWidth <= (child as HTMLElement).clientWidth + 0.5
          );
        }),
      );
      expect(fits, `${day} label fits its button`).toBe(true);
    }
    await easyDays.screenshot({
      path: testInfo.outputPath("easy-days-narrow.png"),
    });
    // Existing mobile clients can patch a different field without losing the new preference.
    const legacy = await page.request.patch("/api/fsrs/settings", {
      data: { newCardsPerDay: original.newCardsPerDay },
    });
    expect((await legacy.json()).easyDays).toEqual(saved.easyDays);
  } finally {
    const restored = await page.request.patch("/api/fsrs/settings", {
      data: {
        easyDays: original.easyDays ?? normal,
        timezone: original.timezone,
        newCardsPerDay: original.newCardsPerDay,
      },
    });
    expect.soft(restored.ok(), "restore study settings").toBeTruthy();
  }
});
