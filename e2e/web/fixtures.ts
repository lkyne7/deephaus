import { expect, type Page } from '@playwright/test';

export function fixture(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`${key} must identify an isolated staging fixture. See docs/launch-readiness.md.`);
  return value;
}

export async function signIn(page: Page, account: 'owner' | 'other' = 'owner') {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture(account === 'owner' ? 'E2E_EMAIL' : 'E2E_OTHER_EMAIL'));
  await page.getByLabel('Password', { exact: true }).fill(fixture(account === 'owner' ? 'E2E_PASSWORD' : 'E2E_OTHER_PASSWORD'));
  await page.getByRole('button', { name: /sign in/i, exact: true }).click();
  await expect(page).toHaveURL(/dashboard/, { timeout: 30_000 });
}

export async function createCard(page: Page, front: string) {
  const response = await page.request.post('/api/cards', {
    data: { project_id: fixture('E2E_DECK_ID'), type: 'basic', front, back: 'Isolated launch fixture' },
  });
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  const id = body.id ?? body.card?.id;
  expect(typeof id).toBe('string');
  return id as string;
}

/** Rows of the Cards page list. */
export function cardRows(page: Page) {
  return page.getByRole('list', { name: 'Card list', exact: true }).getByRole('listitem');
}

export async function browse(page: Page, label: string) {
  await page.goto(`/cards?deck=${fixture('E2E_DECK_ID')}&q=${encodeURIComponent(label)}`);
  await cardRows(page).filter({ hasText: label }).first().click();
  await expect(page.getByRole('textbox', { name: 'Front', exact: true })).toBeVisible();
}

async function openAccountMenu(page: Page) {
  await page.getByRole('button', { name: /^Account menu for / }).click();
}

export async function signOut(page: Page) {
  await openAccountMenu(page);
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/login|\/$/, { timeout: 30_000 });
}

function onSettingsPage(page: Page) {
  return new URL(page.url()).pathname.startsWith('/settings');
}

/**
 * Settings is a full page. Download controls live on its Offline downloads
 * tab; reaching it by client navigation must not start another manager.
 */
export async function offlineLibraryStatus(page: Page) {
  if (!new URL(page.url()).pathname.startsWith('/settings/downloads')) {
    if (!onSettingsPage(page)) {
      await openAccountMenu(page);
      await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
      await expect(page).toHaveURL(/\/settings\//);
    }
    await page.getByRole('link', { name: 'Offline downloads', exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/downloads/);
  }
  return page.getByRole('region', { name: 'Offline library', exact: true }).getByRole('status');
}

/** Return to the page Settings was opened from, by client navigation (no reload). */
export async function closeSettings(page: Page) {
  for (let step = 0; step < 5 && onSettingsPage(page); step += 1) {
    await page.goBack();
  }
  expect(onSettingsPage(page), 'left Settings').toBe(false);
}

/**
 * Delete cards a test created. Failures are soft so a cleanup problem is
 * reported without replacing the error that failed the test.
 */
export async function deleteCards(page: Page, ids: Array<string | null | undefined>) {
  if (page.isClosed()) {
    expect.soft(ids.filter(Boolean), 'cards left behind: their page closed before cleanup').toEqual([]);
    return;
  }
  for (const id of ids) {
    if (!id) continue;
    const ok = await page.request
      .delete(`/api/cards/${id}`)
      .then((response) => response.ok())
      .catch(() => false);
    expect.soft(ok, `delete card ${id}`).toBe(true);
  }
}
