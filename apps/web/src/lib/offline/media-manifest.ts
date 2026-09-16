import type { MediaEntry } from '@deephaus/shared';

/** One database per account. Files themselves remain in the matching CacheStorage. */
export function browserMediaManifest(userId: string) {
  let opening: Promise<IDBDatabase> | null = null;
  function open() {
    if (!opening) opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(`deephaus-media-manifest-${userId}`, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('entries', { keyPath: 'url' });
      request.onerror = () => { opening = null; reject(request.error); };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); opening = null; };
        resolve(db);
      };
    });
    return opening;
  }
  async function write(entries: MediaEntry[], replace = false) {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('entries', 'readwrite');
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error ?? new Error('Media manifest write aborted'));
      transaction.onerror = () => reject(transaction.error);
      const store = transaction.objectStore('entries');
      if (replace) store.clear();
      for (const entry of entries) store.put(entry);
    });
  }
  return {
    async load(): Promise<MediaEntry[]> {
      const db = await open();
      const entries = await new Promise<MediaEntry[]>((resolve, reject) => {
        const request = db.transaction('entries', 'readonly').objectStore('entries').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const legacyKey = `deephaus-media-${userId}:manifest`;
      let legacy: string | null = null;
      try { legacy = localStorage.getItem(legacyKey); } catch { /* IndexedDB can remain available when localStorage is blocked. */ }
      const clearLegacy = () => { try { localStorage.removeItem(legacyKey); } catch { /* The durable copy has already committed. */ } };
      if (legacy && !entries.length) {
        const previous = JSON.parse(legacy) as MediaEntry[];
        await write(previous, true);
        clearLegacy();
        return previous;
      }
      // A completed IndexedDB migration can survive a crash before legacy cleanup.
      if (legacy) clearLegacy();
      return entries;
    },
    save: (entries: MediaEntry[]) => write(entries, true),
    saveEntry: (entry: MediaEntry) => write([entry]),
  };
}
