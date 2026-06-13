"use client";

import { useCallback, useEffect, useState } from "react";
import { mutate } from "swr";
import { HeatmapPanelSkeleton } from "@/components/dashboard/dashboard-skeleton";
import { ReviewHeatmap } from "@/components/dashboard/review-heatmap";
import { useReviewHeatmap } from "@/lib/client-cache/hooks/use-review-heatmap";
import { reviewHeatmapKey } from "@/lib/client-cache/keys";
import type { ReviewHeatmapData } from "@/lib/fsrs/stats";

type Props = {
  initialYear: number;
  availableYears: number[];
  onOpenStats: () => void;
  /** Current-year heatmap from dashboard stats — avoids a second round-trip on load. */
  seedHeatmap?: ReviewHeatmapData | null;
};

export function ReviewHeatmapPanel({
  initialYear,
  availableYears,
  onOpenStats,
  seedHeatmap,
}: Props) {
  const [year, setYear] = useState(initialYear);
  const useSeed = seedHeatmap?.year === year;
  const { data: fetched, isLoading } = useReviewHeatmap(year, !useSeed);
  const heatmap = useSeed ? seedHeatmap : fetched;

  // Seed SWR when dashboard stats arrive so switching back to this year is instant.
  useEffect(() => {
    if (!seedHeatmap) return;
    void mutate(reviewHeatmapKey(seedHeatmap.year), seedHeatmap, { revalidate: false });
  }, [seedHeatmap]);

  const handleYearChange = useCallback((nextYear: number) => {
    setYear(nextYear);
  }, []);

  const loading = !heatmap && isLoading;

  if (loading) {
    return (
      <div style={{ height: "100%", width: "100%", cursor: "pointer" }} onClick={onOpenStats}>
        <HeatmapPanelSkeleton />
      </div>
    );
  }

  if (!heatmap) {
    return (
      <div style={{ height: "100%", width: "100%", cursor: "pointer" }} onClick={onOpenStats}>
        <HeatmapPanelSkeleton />
      </div>
    );
  }

  return (
    <ReviewHeatmap
      year={year}
      counts={heatmap.counts}
      availableYears={availableYears}
      onYearChange={handleYearChange}
      loading={isLoading}
      fillHeight
      onOpenStats={onOpenStats}
    />
  );
}
