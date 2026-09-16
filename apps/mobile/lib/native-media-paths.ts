import type { MediaEntry } from '@deephaus/shared';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function filename(uri: string | undefined, userId: string): string | null {
  if (!uri || !uuid.test(userId)) return null;
  const relativePrefix = `study-media/${userId}/`;
  let name: string;
  if (uri.startsWith(relativePrefix)) name = uri.slice(relativePrefix.length);
  else {
    // Legacy manifests stored a file URL containing the install-specific sandbox.
    // Only accept a file inside this account's managed Documents directory.
    try {
      const url = new URL(uri);
      if (url.protocol !== 'file:' || url.hostname || url.search || url.hash) return null;
      const marker = `/Documents/${relativePrefix}`;
      const at = url.pathname.lastIndexOf(marker);
      if (at < 0) return null;
      name = url.pathname.slice(at + marker.length);
    } catch { return null; }
  }
  return uuid.test(name) ? name : null;
}
function withoutFile(entry: MediaEntry): MediaEntry {
  const { localUri: _discarded, ...rest } = entry;
  return { ...rest, bytes: 0 };
}
/** Disk records are relative to the account, so an iOS sandbox relocation is harmless. */
export function persistNativeMediaEntry(entry: MediaEntry, userId: string): MediaEntry {
  const name = filename(entry.localUri, userId);
  return name ? { ...entry, localUri: `study-media/${userId}/${name}` } : withoutFile(entry);
}
/** Resolve both old absolute records and current relative records in the current sandbox. */
export function restoreNativeMediaEntry(entry: MediaEntry, userId: string, directory: string): MediaEntry {
  const name = filename(entry.localUri, userId);
  return name ? { ...entry, localUri: `${directory}${name}` } : withoutFile(entry);
}
