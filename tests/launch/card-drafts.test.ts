import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('indexedDB', new IDBFactory());
  const entries = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
    removeItem: (key: string) => entries.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

it('migrates legacy drafts and preserves the newer durable copy across module restarts', async () => {
  const key = 'deephaus:draft:owner:card';
  localStorage.setItem(key, 'legacy edit');
  let drafts = await import('../../apps/web/src/lib/card-drafts');
  expect(await drafts.readDraft(key)).toBe('legacy edit');
  expect(localStorage.getItem(key)).toBeNull();
  await drafts.writeDraft(key, 'newer edit');
  localStorage.setItem(key, 'stale legacy copy');
  vi.resetModules();
  drafts = await import('../../apps/web/src/lib/card-drafts');
  expect(await drafts.readDraft(key)).toBe('newer edit');
  expect(await drafts.readDraft('deephaus:draft:another:card')).toBeNull();
  await drafts.removeDraft(key);
  localStorage.setItem(key, "unflushed legacy removal");
  expect(await drafts.readDraft(key)).toBeNull();
});

it('retains the legacy draft if durable storage cannot open', async () => {
  const key = 'deephaus:draft:owner:card';
  localStorage.setItem(key, 'unsaved work');
  vi.stubGlobal('indexedDB', {open: () => { throw new Error('storage unavailable'); }});
  const drafts = await import('../../apps/web/src/lib/card-drafts');
  await expect(drafts.readDraft(key)).rejects.toThrow('storage unavailable');
  expect(localStorage.getItem(key)).toBe('unsaved work');
});
