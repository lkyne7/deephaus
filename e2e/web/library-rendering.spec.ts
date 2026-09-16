import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';

test('measure dashboard expansion with 1k, 10k and 50k card fixtures', async ({page})=>{
  await page.goto('/launch-benchmark');
  await expect(page.getByRole('heading',{name:'Library rendering benchmark'})).toBeVisible();
  const measurements = [];
  for(const cards of [1000,10000,50000]) {
    await page.getByRole('button',{name:`${cards.toLocaleString()} cards`,exact:true}).click();
    await expect(page.getByRole('row')).toHaveCount(8);
    const started = await page.evaluate(()=>performance.now());
    await page.getByRole('button',{name:`Show all ${(cards/25).toLocaleString()} decks`}).click();
    if(cards/25 <= 100) await expect(page.getByRole('row')).toHaveCount(cards/25+1);
    else {
      await expect(page.getByRole('table')).toHaveAttribute('aria-rowcount',String(cards/25+1));
      await expect.poll(()=>page.locator('[data-deck-id]').count()).toBeGreaterThan(7);
      expect(await page.locator('[data-deck-id]').count()).toBeLessThan(50);
    }
    const rendered = await page.evaluate(()=>({
      now: performance.now(), elements: document.querySelectorAll('*').length,
      heapBytes: (performance as Performance & {memory?: {usedJSHeapSize:number}}).memory?.usedJSHeapSize,
    }));
    measurements.push({cards,decks:cards/25,expandMs:Math.round(rendered.now-started),elements:rendered.elements,heapBytes:rendered.heapBytes});
  }
  const first = page.locator('[data-deck-id]').first();
  await first.focus();
  await page.keyboard.press('End');
  const last = page.locator('[data-deck-id]').filter({hasText:'Fixture deck 01999'});
  await expect(last).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('[data-deck-id]').filter({hasText:'Fixture deck 01998'})).toBeFocused();
  await page.getByRole('searchbox',{name:'Search decks'}).fill('Fixture deck 01999');
  await expect(page.locator('[data-deck-id]')).toHaveCount(1);
  await expect(page.locator('[data-deck-id]')).toContainText('Fixture deck 01999');
  const result = {measuredAt:new Date().toISOString(),scope:'Chromium dashboard component, synthetic 25-card decks; not native, network or whole-app memory',measurements};
  await test.info().attach('library-rendering',{body:JSON.stringify(result,null,2),contentType:'application/json'});
  if(process.env.WRITE_BENCHMARK==='1') writeFileSync('docs/library-rendering-benchmark.json',JSON.stringify(result,null,2)+'\n');
});
