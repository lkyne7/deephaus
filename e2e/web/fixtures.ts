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

export async function browse(page: Page, label: string) {
  await page.goto(`/cards?deck=${fixture('E2E_DECK_ID')}&q=${encodeURIComponent(label)}`);
  await page.getByRole('row').filter({ hasText: label }).first().click();
  await expect(page.getByRole('textbox', { name: 'Front', exact: true })).toBeVisible();
}

export async function signOut(page: Page) {
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(/login|\/$/, { timeout: 30_000 });
}
