import { expect, test, type Locator, type Page } from '@playwright/test';
import { createCard, deleteCards, fixture, signIn } from './fixtures';

type Box = { x: number; y: number; width: number; height: number };

async function box(locator: Locator): Promise<Box> {
  const bounds = await locator.boundingBox();
  expect(bounds, 'element is rendered').not.toBeNull();
  return bounds!;
}

function overlaps(a: Box, b: Box) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

async function expectOnScreen(page: Page, locator: Locator, name: string) {
  const viewport = page.viewportSize()!;
  const bounds = await box(locator);
  expect(bounds.x, `${name} left edge`).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width, `${name} right edge`).toBeLessThanOrEqual(viewport.width);
}

test('a fresh 320px session starts with the rail and opens the sidebar over the page', async ({ browser }) => {
  // A new context has no saved sidebar preference.
  const context = await browser.newContext({ viewport: { width: 320, height: 568 } });
  const page = await context.newPage();
  try {
    await signIn(page);
    const main = page.locator('main.dh-app-main');
    const before = await box(main);
    expect(before.width, 'main column width').toBeGreaterThanOrEqual(260);

    const open = page.getByRole('button', { name: /^Open sidebar/ });
    await open.click();
    const decks = page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Decks' });
    await expect(decks).toBeVisible();
    await expectOnScreen(page, page.locator('aside.notion-sidebar'), 'open sidebar');
    // The page underneath keeps its width rather than being squeezed.
    expect((await box(main)).width).toBeCloseTo(before.width, 0);

    await page.keyboard.press('Escape');
    await expect(open).toBeVisible();

    await open.click();
    await decks.click();
    await expect(page).toHaveURL(/\/decks(\?|$)/);
    await expect(open).toBeVisible();

    // Wide windows keep the saved, expanded layout.
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByRole('button', { name: /^Close sidebar/ })).toBeVisible();
  } finally {
    await context.close();
  }
});

test('study controls stay on screen and apart at 320px', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 568 } });
  const page = await context.newPage();
  let id: string | undefined;
  try {
    await signIn(page);
    id = await createCard(page, `Narrow study ${crypto.randomUUID()}`);
    await page.goto(`/decks/${fixture('E2E_DECK_ID')}/study`);
    const show = page.getByRole('button', { name: /^Show answer/i });
    await expect(show).toBeVisible({ timeout: 30_000 });

    const header = page.locator('header.dh-study__top');
    const checkControls = async (aiLabel: 'Hint' | 'Explain') => {
      for (const [locator, name] of [
        [header.getByRole('link').first(), 'back'],
        [header.getByRole('button', { name: aiLabel, exact: true }), aiLabel],
        [header.getByRole('button', { name: /^Edit/ }), 'Edit'],
        [header.getByRole('button', { name: 'More', exact: true }), 'More'],
      ] as const) {
        await expectOnScreen(page, locator, name);
      }
      const undo = await box(page.getByRole('button', { name: /^Undo/ }));
      const redo = await box(page.getByRole('button', { name: /^Redo/ }));
      const counters = await box(page.locator('.dh-study__meta-center'));
      expect(overlaps(undo, counters), 'Undo overlaps the counters').toBe(false);
      expect(overlaps(redo, counters), 'Redo overlaps the counters').toBe(false);
      await expectOnScreen(page, page.getByRole('button', { name: /^Redo/ }), 'Redo');
    };

    await checkControls('Hint');
    await show.click();
    await expect(page.getByRole('button', { name: /^Good/ })).toBeVisible();
    await checkControls('Explain');
  } finally {
    await deleteCards(page, [id]);
    await context.close();
  }
});
