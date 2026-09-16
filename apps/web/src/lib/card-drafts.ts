let opening: Promise<IDBDatabase> | null = null;

function openDrafts(): Promise<IDBDatabase> {
  if (!opening) opening = new Promise((resolve, reject) => {
    const request = indexedDB.open("deephaus-card-drafts", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onerror = () => { opening = null; reject(request.error); };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); opening = null; };
      resolve(db);
    };
  });
  void opening.catch(() => { opening = null; });
  return opening;
}

/** Wait for a durable commit; localStorage can acknowledge writes still lost on a crash. */
async function transaction<T>(action: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
  const db = await openDrafts();
  return new Promise<T>((resolve, reject) => {
    let value: T;
    const tx = db.transaction("drafts", "readwrite", {durability: "strict"});
    tx.oncomplete = () => resolve(value);
    tx.onabort = () => reject(tx.error ?? new Error("Draft storage was interrupted"));
    tx.onerror = () => reject(tx.error);
    action(tx.objectStore("drafts"), result => { value = result; });
  });
}

export async function readDraft(key: string): Promise<string | null> {
  let legacy: string | null = null;
  try { legacy = localStorage.getItem(key); } catch { /* IndexedDB may still be available. */ }
  const value = await transaction<string | null>((store, result) => {
    const request = store.get(key);
    request.onsuccess = () => {
      const current = request.result as string | null | undefined;
      if (current === undefined && legacy !== null) store.put(legacy, key);
      result(current === undefined ? legacy : current);
    };
  });
  if (legacy !== null) {
    try { localStorage.removeItem(key); } catch { /* The migrated copy is committed. */ }
  }
  return value;
}

export async function writeDraft(key: string, snapshot: string): Promise<void> {
  await transaction<void>((store, result) => { store.put(snapshot, key); result(); });
}

// A tombstone prevents an old localStorage copy from returning after a crash.
export async function removeDraft(key: string): Promise<void> {
  await transaction<void>((store, result) => { store.put(null, key); result(); });
  try { localStorage.removeItem(key); } catch { /* Legacy storage can be unavailable. */ }
}
