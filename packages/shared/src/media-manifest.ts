import type { MediaEntry } from './offline-media.js';

export interface ManifestKeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  multiGet(keys: string[]): Promise<readonly (readonly [string, string | null])[]>;
  multiSet(entries: [string, string][]): Promise<void>;
}

/** Native progress uses one small record per image, with a separately committed
 * index. An interrupted new index never advertises an unpersisted download. */
export function keyValueMediaManifest(storage: ManifestKeyValueStorage, legacyKey: string) {
  const indexKey = `${legacyKey}:v2:index`;
  const entryKey = (url: string) => `${legacyKey}:v2:entry:${encodeURIComponent(url)}`;
  async function save(entries: MediaEntry[]) {
    for (let start = 0; start < entries.length; start += 250)
      await storage.multiSet(entries.slice(start, start + 250).map(entry => [entryKey(entry.url), JSON.stringify(entry)]));
    await storage.setItem(indexKey, JSON.stringify(entries.map(entry => entry.url)));
  }
  return {
    async load(): Promise<MediaEntry[]> {
      const index = await storage.getItem(indexKey);
      if (index === null) {
        const legacy = await storage.getItem(legacyKey);
        if (!legacy) return [];
        const entries = JSON.parse(legacy) as MediaEntry[];
        await save(entries);
        await storage.removeItem(legacyKey);
        return entries;
      }
      const urls = JSON.parse(index) as string[];
      const entries: MediaEntry[] = [];
      for (let start = 0; start < urls.length; start += 250) {
        const batch = urls.slice(start, start + 250);
        const values = new Map(await storage.multiGet(batch.map(entryKey)));
        for (const url of batch) {
          const value = values.get(entryKey(url));
          entries.push(value ? JSON.parse(value) : { url, bytes: 0, attempts: 0 });
        }
      }
      return entries;
    },
    save,
    saveEntry: (entry: MediaEntry) => storage.setItem(entryKey(entry.url), JSON.stringify(entry)),
    removeEntry: (entry: MediaEntry) => storage.removeItem(entryKey(entry.url)),
  };
}
