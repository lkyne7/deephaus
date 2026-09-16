import { expect, test } from '@playwright/test';
import { browse, createCard, fixture, signIn, signOut } from './fixtures';

test.skip(Boolean(process.env.NEXT_PUBLIC_POWERSYNC_URL), 'Run the remote-save failure gate with LAUNCH_NETWORK_ONLY=1; initialized PowerSync saves locally.');

test('switching accounts hides the previous account draft and restores it only for its owner', async ({ page, context }) => {
  // Validate both accounts before creating anything.
  fixture('E2E_OTHER_EMAIL'); fixture('E2E_OTHER_PASSWORD');
  await signIn(page);
  const label = `Account isolation ${crypto.randomUUID()}`;
  const id = await createCard(page, label);
  const url = `**/api/cards/${id}`;
  await context.route(url, route => route.request().method() === 'PUT'
    ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Simulated interruption"}' })
    : route.continue());
  try {
    await browse(page, label);
    await page.getByRole('textbox', { name: 'Front', exact: true }).fill(`${label} private draft`);
    await expect(page.getByRole('button', { name: 'Retry save' })).toBeVisible();
    await signOut(page);
    await signIn(page, 'other');
    await page.goto('/cards');
    await expect(page.getByText(`${label} private draft`, { exact: false })).toHaveCount(0);
    expect([403, 404]).toContain((await page.request.get(`/api/cards/${id}`)).status());
    await context.unroute(url);
    expect([403, 404]).toContain((await page.request.put(`/api/cards/${id}`, { data: { front: 'Unauthorized edit' } })).status());
    await signOut(page);
    await signIn(page);
    await browse(page, label);
    await expect(page.getByRole('textbox', { name: 'Front', exact: true })).toContainText('private draft');
    await expect.poll(async () => (await (await page.request.get(`/api/cards/${id}`)).json()).front).toContain('private draft');
  } finally {
    await context.unroute(url);
    // Cleanup always uses a separate authenticated owner page, even when the
    // assertion failed while the shared browser was signed into account B.
    const cleanup = await context.browser()!.newPage();
    try {
      await signIn(cleanup);
      expect((await cleanup.request.delete(`/api/cards/${id}`)).ok()).toBeTruthy();
    } finally { await cleanup.context().close(); }
  }
});
