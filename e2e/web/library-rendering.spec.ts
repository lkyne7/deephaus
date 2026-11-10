import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';

test('measure the deck list with 1k, 10k and 50k card fixtures', async ({page})=>{
  await page.goto('/launch-benchmark');
  await expect(page.getByRole('heading',{name:'Library rendering benchmark'})).toBeVisible();
  const measurements = [];
  for(const cards of [1000,10000,50000]) {
    await page.getByRole('button',{name:`${cards.toLocaleString()} cards`,exact:true}).click();
    const started = await page.evaluate(()=>performance.now());
    if(cards/25 <= 100) await expect(page.locator('[data-deck-id]')).toHaveCount(cards/25);
    else {
      await expect(page.getByRole('listitem').first()).toHaveAttribute('aria-setsize',String(cards/25));
      await expect.poll(()=>page.locator('[data-deck-id]').count()).toBeGreaterThan(7);
      expect(await page.locator('[data-deck-id]').count()).toBeLessThan(50);
    }
    const rendered = await page.evaluate(()=>({
      now: performance.now(), elements: document.querySelectorAll('*').length,
      heapBytes: (performance as Performance & {memory?: {usedJSHeapSize:number}}).memory?.usedJSHeapSize,
    }));
    measurements.push({cards,decks:cards/25,expandMs:Math.round(rendered.now-started),elements:rendered.elements,heapBytes:rendered.heapBytes});
  }
  // Clicking a row selects it and puts the keyboard on the list; the selected row is aria-current.
  await page.locator('[data-deck-id]').first().click();
  const current = page.locator('[data-deck-id][aria-current="true"]');
  await expect(current).toContainText('Fixture deck 00000');
  await expect(page.getByRole('complementary',{name:'Deck summary'})).toContainText('Fixture deck 00000');
  await page.keyboard.press('End');
  await expect(current).toContainText('Fixture deck 01999');
  await page.keyboard.press('ArrowUp');
  await expect(current).toContainText('Fixture deck 01998');
  await page.getByRole('searchbox',{name:'Search decks'}).fill('Fixture deck 01999');
  await expect(page.locator('[data-deck-id]')).toHaveCount(1);
  await expect(page.locator('[data-deck-id]')).toContainText('Fixture deck 01999');
  const result = {measuredAt:new Date().toISOString(),scope:'Chromium deck list component, synthetic 25-card decks; not native, network or whole-app memory',measurements};
  await test.info().attach('library-rendering',{body:JSON.stringify(result,null,2),contentType:'application/json'});
  if(process.env.WRITE_BENCHMARK==='1') writeFileSync('docs/library-rendering-benchmark.json',JSON.stringify(result,null,2)+'\n');
});
