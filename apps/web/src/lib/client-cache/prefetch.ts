"use client";

import { mutate } from "swr";
import { swrFetcher } from "@/lib/client-cache/fetcher";
import { cacheKeys, type CacheKey } from "@/lib/client-cache/keys";
import type { DashboardStats } from "@/lib/fsrs/stats";

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
  "/decks": [cacheKeys.studyDecks],
  "/community": [cacheKeys.communityDecks],
  "/cards": [cacheKeys.deckList],
  "/cram": [cacheKeys.cramPlans],
};

/** Warm caches for the active route — avoids blasting every API on shell mount. */
export function prefetchRouteData(href: string): void {
  const keys = ROUTE_KEYS[href];
  if (!keys) return;
  for (const key of keys) {
    prefetchKey(key);
  }
}

/** Force-revalidate a key with a fresh network fetch (bypass SWR dedupe). */
function forceRevalidate(key: CacheKey): Promise<unknown> {
  return mutate(key, () => swrFetcher(key), { revalidate: false }).catch(() => {});
}

/** Invalidate stats after a study session so counts refresh everywhere. */
export function invalidateStudyCaches(): void {
  void forceRevalidate(cacheKeys.dashboardStats);
  void forceRevalidate(cacheKeys.studyDecks);
}

/** Invalidate every deck list surface after create/rename/delete/duplicate. */
export function invalidateDeckCaches(): void {
  invalidateStudyCaches();
  void forceRevalidate(cacheKeys.deckList);
}

/**
 * Insert a duplicated deck into dashboard stats, then refetch.
 * Optimistic row is applied first; the refetch uses the busted server cache.
 */
export async function applyDuplicatedDeckToCaches(copy: {
  id: string;
  name: string;
  cardCount?: number;
}): Promise<void> {
  const total = copy.cardCount ?? 0;

  await mutate(
    cacheKeys.dashboardStats,
    (current: DashboardStats | undefined) => {
      if (!current) return current;
      if (current.per_deck.some((d) => d.deck_id === copy.id)) return current;
      return {
        ...current,
        total_cards: current.total_cards + total,
        new_today_remaining: current.new_today_remaining + total,
        per_deck: [
          {
            deck_id: copy.id,
            name: copy.name,
            due: 0,
            new: total,
            last_reviewed: null,
            total,
            new_card_count: total,
            is_community: false,
            is_published: false,
          },
          ...current.per_deck,
        ],
      };
    },
    { revalidate: false },
  );

  // Refetch after the mutation route has bumped the server cache epoch.
  await Promise.all([
    forceRevalidate(cacheKeys.dashboardStats),
    forceRevalidate(cacheKeys.studyDecks),
    forceRevalidate(cacheKeys.deckList),
  ]);
}
