import { expect, test } from '@playwright/test';
import { fixture, signIn } from './fixtures';

test('production offline restart preserves a review and uploads it once after reconnection', async ({ page, context, request }) => {
  test.skip(process.env.E2E_PRODUCTION_SERVICE_WORKER !== '1' || !process.env.NEXT_PUBLIC_POWERSYNC_URL?.includes('6a79589f2a3eee482f24045d'), 'Requires the staging production build with PowerSync.');
  test.setTimeout(120_000);
  await signIn(page);
  const base = fixture('E2E_SUPABASE_URL');
  const apikey = fixture('E2E_SUPABASE_ANON_KEY');
  const auth = await request.post(`${base}/auth/v1/token?grant_type=password`, { headers: { apikey }, data: { email: fixture('E2E_EMAIL'), password: fixture('E2E_PASSWORD') } });
  expect(auth.ok()).toBeTruthy();
  const session = await auth.json();
  const headers = { apikey, Authorization: `Bearer ${session.access_token}` };
  const deckId = crypto.randomUUID();
  const label = `Offline restart ${Date.now()}`;
  const created = await request.post(`${base}/rest/v1/projects`, { headers, data: { id: deckId, user_id: session.user.id, name: label, deck_name: label } });
  expect(created.ok()).toBeTruthy();
  try {
    const createdCard = await page.request.post('/api/cards', { data: { project_id: deckId, type: 'basic', front: `<p>${label}</p><p><img src="${new URL('/icon-192.png', page.url()).href}" alt="Offline study image" /></p>`, back: 'Saved offline answer' } });
    expect(createdCard.ok()).toBeTruthy();
    const body = await createdCard.json();
    const cardId = body.id ?? body.card?.id;
    await page.goto(`/decks/${deckId}/study`);
    const status = () => page.getByRole('complementary', { name: 'Offline library' }).getByRole('status');
    await expect(status()).toContainText('Ready offline', { timeout: 60_000 });
    await expect(status()).toContainText('1/1 media');
    await expect(page.getByRole('button', { name: 'Show Answer' })).toBeVisible();
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await expect.poll(() => page.evaluate(async () => Boolean(await caches.match(location.href)))).toBe(true);
    const offlineUrl = page.url();
    await page.close();
    await context.setOffline(true);
    page = await context.newPage();
    await page.goto(offlineUrl);
    await expect(page.getByText(label, { exact: true })).toBeVisible();
    await expect(status()).toContainText('Ready offline');
    await expect.poll(() => page.locator('img[src^="blob:"]').evaluateAll(images => images.some(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
    await page.reload();
    await expect(page.getByText(label, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Show Answer' }).click();
    await page.getByRole('button', { name: /^Good/ }).click();
    // One answer queues the scheduling row and its append-only history row.
    await expect(status()).toContainText('2 uploads pending');
    const studyUrl = page.url();
    await page.close();
    page = await context.newPage();
    await page.goto(studyUrl);
    await expect(status()).toContainText('2 uploads pending', { timeout: 30_000 });
    await expect(status()).toContainText('Ready offline');
    await context.setOffline(false);
    await expect(status()).toContainText('0 uploads pending', { timeout: 45_000 });
    const logs = async () => {
      const response = await request.get(`${base}/rest/v1/review_logs?card_id=eq.${cardId}&select=id`, { headers });
      expect(response.ok()).toBeTruthy();
      return response.json();
    };
    await expect.poll(async () => (await logs()).length).toBe(1);
    await page.reload();
    await expect(status()).toContainText('0 uploads pending');
    expect(await logs()).toHaveLength(1);
  } finally {
    await context.setOffline(false);
    const removed = await request.delete(`${base}/rest/v1/projects?id=eq.${deckId}`, { headers });
    expect(removed.ok()).toBeTruthy();
    await request.post(`${base}/auth/v1/logout?scope=local`, { headers });
  }
});
