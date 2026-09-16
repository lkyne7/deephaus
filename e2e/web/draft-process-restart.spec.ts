import { chromium, expect, test } from '@playwright/test';
import { signIn, createCard, browse } from './fixtures';

test.skip(Boolean(process.env.NEXT_PUBLIC_POWERSYNC_URL), 'Run the remote-save failure gate with LAUNCH_NETWORK_ONLY=1; initialized PowerSync saves locally.');

test('an unsaved draft survives a browser process crash and profile restart', async ({}, info) => {
  test.setTimeout(120_000);
  const profile = info.outputPath('isolated-browser-profile');
  const options = {baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000', headless: true};
  let context = await chromium.launchPersistentContext(profile, options);
  context.setDefaultTimeout(15_000);
  let page = await context.newPage();
  let id: string | undefined;
  const label = `Launch process restart ${crypto.randomUUID()}`;
  try {
    await signIn(page);
    id = await createCard(page, label);
    const blockSave = async () => context.route(`**/api/cards/${id}`, route =>
      route.request().method() === 'PUT'
        ? route.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({error: 'Simulated outage'})})
        : route.continue());
    await blockSave();
    await browse(page, label);
    await page.getByRole('textbox', {name: 'Front', exact: true}).fill(`${label} latest unsaved work`);
    await expect(page.getByRole('button', {name: 'Retry save'})).toBeVisible();
    const cdp = await context.browser()!.newBrowserCDPSession();
    const {processInfo} = await cdp.send('SystemInfo.getProcessInfo');
    const browserProcess = processInfo.find(process => process.type === 'browser');
    expect(browserProcess).toBeDefined();
    // Kill only this test-owned Chromium process, without page unload handlers.
    process.kill(browserProcess!.id, 'SIGKILL');
    await expect.poll(() => context.browser()!.isConnected()).toBe(false);
    await context.close();
    context = await chromium.launchPersistentContext(profile, options);
    context.setDefaultTimeout(15_000);
    page = await context.newPage();
    await blockSave();
    // Session cookies need not survive a crash; local drafts must survive reauthentication.
    await page.goto('/dashboard');
    if (!new URL(page.url()).pathname.startsWith('/dashboard')) await signIn(page);
    await browse(page, label);
    await expect(page.getByRole('textbox', {name: 'Front', exact: true})).toContainText('latest unsaved work');
    await expect(page.getByRole('button', {name: 'Retry save'})).toBeVisible();
    await context.unrouteAll({behavior: 'wait'});
    await page.getByRole('button', {name: 'Retry save'}).click();
    await expect(page.getByRole('status').filter({hasText: 'Saved'})).toBeVisible();
    expect((await (await page.request.get(`/api/cards/${id}`)).json()).front).toContain('latest unsaved work');
  } finally {
    if (id && !page.isClosed()) {
      await context.unrouteAll({behavior: 'wait'});
      await page.goto('/dashboard');
      expect((await page.request.delete(`/api/cards/${id}`)).ok()).toBeTruthy();
    }
    await context.close();
  }
});
