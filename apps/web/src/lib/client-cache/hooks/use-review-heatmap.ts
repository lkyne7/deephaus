"use client";

import useSWR from "swr";
import { reviewHeatmapKey } from "@/lib/client-cache/keys";
import type { ReviewHeatmapData } from "@/lib/fsrs/stats";

/** Lazy-load heatmap years other than the current year bundled in dashboard stats. */
export function useReviewHeatmap(year: number, enabled = true) {
  return useSWR<ReviewHeatmapData>(enabled ? reviewHeatmapKey(year) : null);
}
