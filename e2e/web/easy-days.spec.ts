import { expect, test } from "@playwright/test";
import { signIn, closeSettings } from "./fixtures";

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
    await page.goto("/dashboard?settings=study");
    const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
    const save = async () => {
      const completed = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/fsrs/settings") &&
          response.request().method() === "PATCH",
      );
      await dialog.getByRole("button", { name: "Save", exact: true }).click();
      expect((await completed).ok()).toBeTruthy();
      await expect(
        dialog.getByRole("button", { name: "Saving…", exact: true }),
      ).toBeHidden();
    };
    const weekend = dialog.getByRole("button", {
      name: "Weekend warrior",
      exact: true,
    });
    await weekend.click();
    await expect(
      dialog.getByRole("slider", { name: "Saturday review load" }),
    ).toHaveValue("1");
    await expect(
      dialog.getByRole("slider", { name: "Sunday review load" }),
    ).toHaveValue("1");
    await expect(
      dialog.getByRole("slider", { name: "Monday review load" }),
    ).toHaveValue("2");
    await save();
    const easyDays = dialog.getByRole("group", {
      name: "Easy Days",
      exact: true,
    });
    await easyDays.screenshot({
      path: testInfo.outputPath("easy-days-desktop.png"),
    });
    await closeSettings(page);
    await page.reload();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await dialog.getByRole("button", { name: "Study", exact: true }).click();
    await expect(weekend).toHaveAttribute("aria-pressed", "true");
    await dialog
      .getByRole("slider", { name: "Wednesday review load" })
      .fill("0");
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
    expect(bounds?.width).toBeGreaterThan(300);
    expect(bounds?.x).toBeGreaterThanOrEqual(0);
    expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(390);
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
    expect(restored.ok()).toBeTruthy();
  }
});
