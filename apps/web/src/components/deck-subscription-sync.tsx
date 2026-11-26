"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Pulls community deck updates after paint so the page around it stays fast.
 * `onSynced` runs when updates came in; without it the route refreshes.
 */
export function DeckSubscriptionSync({ deckId, onSynced }: { deckId: string; onSynced?: () => void }) {
  const router = useRouter();
  const onSyncedRef = useRef(onSynced);
  onSyncedRef.current = onSynced;

  useEffect(() => {
    let cancelled = false;

    const run = () => {
      if (cancelled) return;
      void fetch(`/api/decks/${deckId}/sync-subscription`, {
        method: "POST",
        credentials: "include",
      })
        .then(async (res) => {
          if (!res.ok || cancelled) return;
          const body = (await res.json()) as { synced?: boolean };
          if (!body.synced) return;
          if (onSyncedRef.current) onSyncedRef.current();
          else router.refresh();
        })
        .catch(() => {
          // Best-effort background sync.
        });
    };

    if (typeof requestIdleCallback !== "undefined") {
      const id = requestIdleCallback(run, { timeout: 3000 });
      return () => {
        cancelled = true;
        cancelIdleCallback(id);
      };
    }

    const timer = setTimeout(run, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [deckId, router]);

  return null;
}
