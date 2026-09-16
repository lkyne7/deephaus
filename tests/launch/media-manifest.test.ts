import { afterEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { keyValueMediaManifest, type ManifestKeyValueStorage } from '../../packages/shared/src/media-manifest';
import { OfflineMediaLibrary, type MediaEntry, type MediaReadiness } from '../../packages/shared/src/offline-media';
import { browserMediaManifest } from '../../apps/web/src/lib/offline/media-manifest';

afterEach(() => vi.unstubAllGlobals());
function keyValue() {
  const data = new Map<string,string>();
  let writes = 0;
  const storage: ManifestKeyValueStorage = {
    async getItem(k) { return data.get(k) ?? null; },
    async setItem(k,v) { writes += v.length; data.set(k,v); },
    async removeItem(k) { data.delete(k); },
    async multiGet(keys) { return keys.map(k => [k,data.get(k) ?? null] as const); },
    async multiSet(rows) { for (const [k,v] of rows) { writes += v.length; data.set(k,v); } },
  };
  return { storage, data, writtenBytes: () => writes };
}
const entry = (id: number): MediaEntry => ({ url: `https://media.test/${id}.png`, bytes: 0, attempts: 0 });

it('migrates legacy native manifests once and isolates incremental progress by account', async () => {
  const { storage, data } = keyValue();
  const previous = { ...entry(1), bytes: 12, localUri: 'file:///owner/1' };
  data.set('owner',JSON.stringify([previous]));
  const owner = keyValueMediaManifest(storage,'owner');
  expect(await owner.load()).toEqual([previous]);
  expect(data.has('owner')).toBe(false);
  await owner.saveEntry({ ...previous, bytes: 24 });
  expect((await keyValueMediaManifest(storage,'owner').load())[0]!.bytes).toBe(24);
  expect(await keyValueMediaManifest(storage,'other').load()).toEqual([]);
});

it('keeps missing native progress records pending after partial storage loss', async () => {
  const { storage, data } = keyValue();
  const manifest = keyValueMediaManifest(storage,'owner');
  await manifest.save([{ ...entry(1), bytes: 12, localUri: 'file:///owner/1' }]);
  for (const key of data.keys()) if (key.includes(':entry:')) data.delete(key);
  expect(await manifest.load()).toEqual([entry(1)]);
});

it('persists 50,000 completed downloads without quadratic manifest writes or writes on unchanged verification', async () => {
  const { storage, writtenBytes } = keyValue();
  const manifest = keyValueMediaManifest(storage,'owner');
  let state: MediaReadiness | undefined;
  let publications = 0;
  const queue = new OfflineMediaLibrary({ ...manifest,
    exists: async () => true, remove: async () => {},
    download: async (url) => ({ localUri: url, bytes: 100 }),
  }, next => { state = next; publications++; });
  await queue.initialize();
  await queue.reconcile(Array.from({length:50_000},(_,i)=>entry(i).url),true);
  const started = writtenBytes();
  await queue.run();
  expect(state?.state).toBe('Ready offline');
  expect(state?.downloaded).toBe(50_000);
  // A full rewrite per image would write hundreds of gigabytes. Incremental
  // records keep this proportional to the library size, independent of CPU speed.
  expect(writtenBytes()-started).toBeLessThan(12_000_000);
  expect(publications).toBeLessThan(500);
  const beforeVerify = writtenBytes();
  await queue.verify([entry(42).url]);
  expect(writtenBytes()).toBe(beforeVerify);
  const reopened = await keyValueMediaManifest(storage,'owner').load();
  expect(reopened.filter(row=>row.localUri)).toHaveLength(50_000);
},30_000);

it('moves browser manifests into IndexedDB and durably updates only the selected account', async () => {
  vi.stubGlobal('indexedDB',new IDBFactory());
  const legacy = new Map<string,string>([['deephaus-media-owner:manifest',JSON.stringify([entry(1)])]]);
  vi.stubGlobal('localStorage', { getItem: (key:string)=>legacy.get(key)??null, removeItem: (key:string)=>legacy.delete(key) });
  const owner = browserMediaManifest('owner');
  expect(await owner.load()).toEqual([entry(1)]);
  expect(legacy.size).toBe(0);
  await owner.saveEntry({ ...entry(1), localUri: entry(1).url, bytes: 100 });
  expect((await browserMediaManifest('owner').load())[0]!.bytes).toBe(100);
  expect(await browserMediaManifest('other').load()).toEqual([]);
  vi.stubGlobal('localStorage', {
    getItem: () => { throw new Error('localStorage unavailable'); },
    removeItem: () => { throw new Error('localStorage unavailable'); },
  });
  expect((await browserMediaManifest('owner').load())[0]!.bytes).toBe(100);
  await owner.save([]);
  expect(await owner.load()).toEqual([]);
});
