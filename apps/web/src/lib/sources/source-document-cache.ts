import type { JSONContent } from "@tiptap/core";

type CachedDocument = {
  content: JSONContent;
  contentEditedAt?: string | null;
};

const cache = new Map<string, CachedDocument>();
const inflight = new Map<string, Promise<CachedDocument | null>>();

export function getCachedSourceDocument(sourceId: string): CachedDocument | null {
  return cache.get(sourceId) ?? null;
}

export function setCachedSourceDocument(
  sourceId: string,
  content: JSONContent,
  contentEditedAt?: string | null,
) {
  cache.set(sourceId, { content, contentEditedAt: contentEditedAt ?? null });
}

export function invalidateCachedSourceDocument(sourceId: string) {
  cache.delete(sourceId);
  inflight.delete(sourceId);
}

/** Warm the cache so Create deck switches can skip the loading state. */
export function prefetchSourceDocument(sourceId: string): Promise<CachedDocument | null> {
  const hit = cache.get(sourceId);
  if (hit) return Promise.resolve(hit);

  const pending = inflight.get(sourceId);
  if (pending) return pending;

  const request = (async () => {
    try {
      const res = await fetch(`/api/sources/${sourceId}/document`, { credentials: "include" });
      if (!res.ok) return null;
      const data = (await res.json()) as {
        content: JSONContent;
        contentEditedAt?: string | null;
      };
      if (!data.content) return null;
      const entry = {
        content: data.content,
        contentEditedAt: data.contentEditedAt ?? null,
      };
      cache.set(sourceId, entry);
      return entry;
    } catch {
      return null;
    } finally {
      inflight.delete(sourceId);
    }
  })();

  inflight.set(sourceId, request);
  return request;
}
