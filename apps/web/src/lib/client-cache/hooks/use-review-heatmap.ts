"use client";

import useSWR from "swr";
import { reviewHeatmapKey } from "@/lib/client-cache/keys";
import type { ReviewHeatmapData } from "@/lib/fsrs/stats";

/** One year of activity, for the whole account or a single deck. */
export function useReviewHeatmap(year: number, deckId?: string | null) {
  return useSWR<ReviewHeatmapData>(reviewHeatmapKey(year, deckId));
}
