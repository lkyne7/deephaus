import { expect, test } from '@playwright/test';

test('production service worker serves cached pages and an honest fallback without caching API responses', async ({page, context}) => {
  test.skip(process.env.E2E_PRODUCTION_SERVICE_WORKER !== '1', 'Requires launch:build followed by launch:start, not next dev.');
  await page.goto('/login');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBeTruthy();
  await page.reload();
  const onlineText = await page.locator('main').innerText();
  await expect.poll(() => page.evaluate(async () => Boolean(await caches.match(location.href)))).toBeTruthy();
  const status = await page.evaluate(async () => (await fetch('/api/account')).status);
  expect(status).toBe(401);
  expect(await page.evaluate(async () => {
    const keys = await caches.keys();
    return (await Promise.all(keys.map(async key => (await (await caches.open(key)).keys()).map(request => new URL(request.url).pathname)))).flat().filter(path => path.startsWith('/api/'));
  })).toEqual([]);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('main')).toHaveText(onlineText, {useInnerText: true});
  const offlineApi = await page.evaluate(async () => {
    try { return {status: (await fetch('/api/account')).status}; }
    catch { return {networkError: true}; }
  });
  expect(offlineApi).toEqual({networkError: true});
  // A fresh document tests cold navigation without racing the cached page's hydration.
  const uncached = await context.newPage();
  await uncached.goto(`/not-downloaded-${Date.now()}`);
  await expect(uncached.getByRole('heading', {name: "You're offline"})).toBeVisible();
  await expect(uncached.getByRole('link', {name: 'Go to dashboard'})).toBeVisible();
  await expect(uncached.getByText(/Reconnect to load this page/)).toBeVisible();
});
