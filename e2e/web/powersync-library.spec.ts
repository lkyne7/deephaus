import { expect, test } from '@playwright/test';
import { browse, createCard, signIn, offlineLibraryStatus, closeSettings } from './fixtures';

test('real staging replica downloads card media and renders it without network access', async ({ page, context }) => {
  test.skip(process.env.NEXT_PUBLIC_POWERSYNC_URL !== 'https://6a79589f2a3eee482f24045d.powersync.journeyapps.com', 'Requires the isolated staging PowerSync instance.');
  test.setTimeout(120_000);
  await signIn(page);
  await expect(page.getByRole('complementary', { name: 'Offline library' })).toHaveCount(0);
  await expect(await offlineLibraryStatus(page)).toContainText('Downloaded', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Pause downloads', exact: true }).click();
  await closeSettings(page);
  await expect(await offlineLibraryStatus(page)).toContainText('Downloads paused');
  await page.getByRole('button', { name: 'Resume downloads', exact: true }).click();
  await closeSettings(page);
  const label = `Offline media ${Date.now()}`;
  const imageUrl = new URL('/icon-192.png', page.url()).href;
  const id = await createCard(page, `<p>${label}</p><p><img src="${imageUrl}" alt="Offline library image" /></p>`);
  try {
    await expect(await offlineLibraryStatus(page)).toContainText(/1\/1 images/, { timeout: 60_000 });
    await expect(await offlineLibraryStatus(page)).toContainText(/Downloaded|Ready offline/);
    await browse(page, label);
    await expect(await offlineLibraryStatus(page)).toContainText(/Downloaded|Ready offline/);
    await closeSettings(page);
    const downloaded = await page.evaluate(async ({ imageUrl }) => {
      const names = await caches.keys();
      for (const name of names.filter(name => name.startsWith('deephaus-media-'))) {
        if (await (await caches.open(name)).match(imageUrl)) return true;
      }
      return false;
    }, { imageUrl });
    expect(downloaded).toBe(true);
    await context.setOffline(true);
    // The app is already loaded in development; production-shell restart is a separate gate.
    await expect(page.getByRole('textbox', { name: 'Front', exact: true })).toContainText(label);
    await expect.poll(() => page.locator('img[src^="blob:"]').evaluateAll(images => images.some(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  } finally {
    await context.setOffline(false);
    await page.request.delete(`/api/cards/${id}`);
  }
});
