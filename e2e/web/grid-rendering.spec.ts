import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';

test('measure grid expansion and keyboard access at 1k, 10k and 50k cards', async ({page}) => {
  await page.goto('/launch-benchmark');
  await page.getByRole('button', {name: 'Grid view', exact: true}).click();
  const measurements = [];
  for (const cards of [1000, 10000, 50000]) {
    await page.getByRole('button', {name: `${cards.toLocaleString()} cards`, exact: true}).click();
    await expect(page.locator('[data-deck-id]')).toHaveCount(7);
    const start = await page.evaluate(() => performance.now());
    await page.getByRole('button', {name: `Show all ${(cards / 25).toLocaleString()} decks`}).click();
    await expect.poll(() => page.locator('[data-deck-id]').count()).toBeGreaterThan(7);
    expect(await page.locator('[data-deck-id]').count()).toBeLessThan(100);
    measurements.push({cards, decks: cards / 25, ...await page.evaluate(start => ({
      expandMs: Math.round(performance.now() - start), elements: document.querySelectorAll('*').length,
    }), start)});
  }
  await page.locator('[data-deck-id]').first().focus();
  await page.keyboard.press('End');
  await expect(page.locator('[data-deck-id]').filter({hasText: 'Fixture deck 01999'})).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('[data-deck-id]').filter({hasText: 'Fixture deck 01998'})).toBeFocused();
  await expect(page.getByRole('listitem').filter({hasText: 'Fixture deck 01998'})).toHaveAttribute('aria-setsize', '2000');

  await page.setViewportSize({width: 390, height: 844});
  await page.addStyleTag({content: '.dh-deck-grid-card { font-size: 200%; } .dh-deck-grid-card * { font-size: inherit !important; line-height: 1.5 !important; }'});
  await page.locator('[data-deck-id]').first().focus();
  await page.keyboard.press('Home');
  await expect(page.locator('[data-deck-id]').filter({hasText: 'Fixture deck 00000'})).toBeFocused();
  await page.keyboard.press('ArrowDown');
  const second = page.locator('[data-deck-id]').filter({hasText: 'Fixture deck 00001'});
  await expect(second).toBeFocused();
  await expect.poll(async () => {
    const first = await page.locator('[data-deck-id]').filter({hasText: 'Fixture deck 00000'}).boundingBox();
    const next = await second.boundingBox();
    return Boolean(first && next && next.y >= first.y + first.height);
  }).toBeTruthy();
  await page.getByRole('searchbox', {name: 'Search decks'}).fill('Fixture deck 01999');
  await expect(page.locator('[data-deck-id]')).toHaveCount(1);
  const result = {measuredAt: new Date().toISOString(), scope: 'Chromium synthetic dashboard grid, 25 cards per deck; not native or whole-app memory', measurements};
  await test.info().attach('grid-rendering', {body: JSON.stringify(result, null, 2), contentType: 'application/json'});
  if (process.env.WRITE_BENCHMARK === '1') writeFileSync('docs/grid-rendering-benchmark.json', JSON.stringify(result, null, 2) + '\n');
});
