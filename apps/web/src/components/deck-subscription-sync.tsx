"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Pulls community deck updates after paint so deck page SSR stays fast. */
export function DeckSubscriptionSync({ deckId }: { deckId: string }) {
  const router = useRouter();

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
          if (body.synced) router.refresh();
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
