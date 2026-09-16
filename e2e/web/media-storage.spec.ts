import { expect, test } from '@playwright/test';

test('browser media storage survives reload, detects eviction, and recovers from quota errors', async ({page, context}) => {
  await page.goto('/launch-benchmark/media');
  await expect(page.getByRole('status')).toHaveText('Downloading: 0/1');
  await page.getByRole('button', {name: 'Download or retry'}).click();
  await expect(page.getByRole('status')).toHaveText('Ready offline: 1/1');
  const image = page.getByRole('img', {name: 'Downloaded card fixture'});
  await expect(image).toHaveAttribute('src', /^blob:/);
  const persisted = await page.evaluate(async () => {
    const cache = await caches.open('deephaus-media-launch-browser-media-fixture');
    const response = await cache.match(`${location.origin}/icon-512.png`);
    const rows = await new Promise<unknown[]>((resolve, reject) => {
      const request = indexedDB.open('deephaus-media-manifest-launch-browser-media-fixture', 1);
      request.onsuccess = () => {
        const db = request.result;
        const read = db.transaction('entries').objectStore('entries').getAll();
        read.onsuccess = () => { resolve(read.result); db.close(); };
        read.onerror = () => reject(read.error);
      };
    });
    return {bytes: response?.headers.get('x-deephaus-media-bytes'), rows};
  });
  await test.info().attach('persisted-media', {body: JSON.stringify(persisted), contentType: 'application/json'});
  expect(persisted.rows).toEqual([expect.objectContaining({localUri: expect.stringContaining('/icon-512.png')})]);
  expect(Number(persisted.bytes)).toBeGreaterThan(0);
  await page.reload();
  await expect(page.getByRole('status')).toHaveText('Ready offline: 1/1');
  await context.setOffline(true);
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBeTruthy();
  await page.getByRole('button', {name: 'Check card completeness'}).click();
  await expect(page.getByText('Card complete', {exact: true})).toBeVisible();
  // Remove only this synthetic account's cache to reproduce browser eviction.
  await page.evaluate(() => caches.delete('deephaus-media-launch-browser-media-fixture'));
  await page.getByRole('button', {name: 'Check card completeness'}).click();
  await expect(page.getByText('Card deferred: media unavailable')).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Downloading: 0/1');
  await context.setOffline(false);
  await page.evaluate(() => {
    const original = Cache.prototype.put;
    Cache.prototype.put = async function () {
      Cache.prototype.put = original;
      throw new DOMException('Injected browser quota exhaustion', 'QuotaExceededError');
    };
  });
  await page.getByRole('button', {name: 'Download or retry'}).click();
  await expect(page.getByRole('status')).toHaveText('Needs attention: 0/1');
  await page.getByRole('button', {name: 'Download or retry'}).click();
  await expect(page.getByRole('status')).toHaveText('Ready offline: 1/1');
  await expect(image).toHaveAttribute('src', /^blob:/);
});
