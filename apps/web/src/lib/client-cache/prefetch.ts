"use client";

import { mutate } from "swr";
import { swrFetcher } from "@/lib/client-cache/fetcher";
import { cacheKeys, type CacheKey } from "@/lib/client-cache/keys";

function prefetchKey(key: CacheKey): void {
  void mutate(
    key,
    async () => {
      try {
        return await swrFetcher(key);
      } catch {
        // Prefetch is best-effort; route hooks retry when the user navigates.
        return undefined;
      }
    },
    { revalidate: false },
  ).catch(() => {
    // Swallow abort/network errors from background prefetch.
  });
}

const ROUTE_KEYS: Record<string, CacheKey[]> = {
  "/dashboard": [cacheKeys.dashboardStats],
  "/study": [cacheKeys.studyDecks],
  "/community": [cacheKeys.communityDecks],
  "/decks": [cacheKeys.deckList],
};

/** Warm caches for the active route — avoids blasting every API on shell mount. */
export function prefetchRouteData(href: string): void {
  const keys = ROUTE_KEYS[href];
  if (!keys) return;
  for (const key of keys) {
    prefetchKey(key);
  }
}

/** Invalidate stats after a study session so counts refresh everywhere. */
export function invalidateStudyCaches(): void {
  void mutate(cacheKeys.dashboardStats).catch(() => {});
  void mutate(cacheKeys.studyDecks).catch(() => {});
}
