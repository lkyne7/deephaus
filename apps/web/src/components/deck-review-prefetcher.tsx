"use client";

import { useEffect } from "react";
import { schedulePrefetchReviewQueue } from "@/lib/study/review-cache";

/**
 * Warms the review-queue cache for a deck while the user is on its deck page,
 * so opening the reviewer ("Study Now") renders without a cold fetch.
 */
export function DeckReviewPrefetcher({ deckId, enabled }: { deckId: string; enabled: boolean }) {
  useEffect(() => {
    if (enabled) schedulePrefetchReviewQueue(deckId);
  }, [deckId, enabled]);

  return null;
}
