/**
 * Tiny client-side cache for the review-queue response so the reviewer can
 * render instantly. We warm it when a deck page opens (or on sidebar hover)
 * and consume it once when {@link StudyMode} mounts.
 *
 * Entries are short-lived and consumed once: after a queue is read the next
 * load always fetches fresh data so due/new counts stay accurate.
 */

const TTL_MS = 30_000;

type CacheEntry = { ts: number; promise: Promise<unknown> };

const cache = new Map<string, CacheEntry>();

function isFresh(entry: CacheEntry): boolean {
  return Date.now() - entry.ts < TTL_MS;
}

/**
 * Kick off (or reuse) a background fetch of a deck's review queue. Safe to call
 * repeatedly — a fresh in-flight/cached entry is reused instead of refetched.
 */
export function prefetchReviewQueue(deckId: string): void {
  if (typeof window === "undefined" || !deckId) return;

  const existing = cache.get(deckId);
  if (existing && isFresh(existing)) return;

  const promise = fetch(`/api/decks/${deckId}/review`, { cache: "no-store" }).then(
    async (res) => {
      if (!res.ok) {
        throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
      }
      return res.json();
    },
  );

  // Drop failed warm-ups so the reviewer falls back to a fresh fetch.
  promise.catch(() => {
    if (cache.get(deckId)?.promise === promise) cache.delete(deckId);
  });

  cache.set(deckId, { ts: Date.now(), promise });
}

/** Defer queue warm-up until the browser is idle (or after a short delay). */
export function schedulePrefetchReviewQueue(deckId: string): void {
  if (typeof window === "undefined" || !deckId) return;

  const run = () => prefetchReviewQueue(deckId);

  if (typeof requestIdleCallback !== "undefined") {
    requestIdleCallback(run, { timeout: 2500 });
    return;
  }

  setTimeout(run, 400);
}

/**
 * Take a previously warmed review queue, if any. Returns `null` when nothing is
 * cached or the entry is stale. The entry is removed so subsequent loads (e.g.
 * after finishing a session) always fetch fresh data.
 */
export function consumeReviewQueue(deckId: string): Promise<unknown> | null {
  const entry = cache.get(deckId);
  if (!entry) return null;
  cache.delete(deckId);
  return isFresh(entry) ? entry.promise : null;
}
