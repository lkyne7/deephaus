"use client";

import { useEffect, useState } from "react";
import { mutate } from "swr";
import { HeatmapPanelSkeleton } from "@/components/dashboard/dashboard-skeleton";
import { HeatmapModal } from "@/components/dashboard/heatmap-modal";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { ReviewHeatmap } from "@/components/dashboard/review-heatmap";
import { useReviewHeatmap } from "@/lib/client-cache/hooks/use-review-heatmap";
import { reviewHeatmapKey } from "@/lib/client-cache/keys";
import type { ReviewHeatmapData } from "@/lib/fsrs/stats";

type Props = {
  initialYear: number;
  /** Current-year heatmap from dashboard stats — avoids a second round-trip on load. */
  seedHeatmap?: ReviewHeatmapData | null;
};

export function ReviewHeatmapPanel({ initialYear, seedHeatmap }: Props) {
  const [overlayOpen, setOverlayOpen] = useState(false);
  const useSeed = seedHeatmap?.year === initialYear;
  const { data: fetched, isLoading, error, mutate: retry } = useReviewHeatmap(
    initialYear,
    !useSeed,
  );
  const heatmap = useSeed ? seedHeatmap : fetched;

  useEffect(() => {
    if (!seedHeatmap) return;
    void mutate(reviewHeatmapKey(seedHeatmap.year), seedHeatmap, { revalidate: false });
  }, [seedHeatmap]);

  const loading = !heatmap && isLoading;

  if (!heatmap && !loading && error) {
    return (
      <LoadErrorState label="your activity" onRetry={() => void retry()} compact />
    );
  }

  if (loading || !heatmap) {
    return (
      <div
        style={{ height: "100%", width: "100%", cursor: "pointer" }}
        onClick={() => setOverlayOpen(true)}
      >
        <HeatmapPanelSkeleton />
        <HeatmapModal
          open={overlayOpen}
          onClose={() => setOverlayOpen(false)}
          initialYear={initialYear}
        />
      </div>
    );
  }

  return (
    <>
      <ReviewHeatmap
        year={heatmap.year}
        counts={heatmap.counts}
        forecast={heatmap.forecast ?? {}}
        loading={isLoading}
        fillHeight
        fitWidth
        onOpen={() => setOverlayOpen(true)}
        title="Activity"
      />
      <HeatmapModal
        open={overlayOpen}
        onClose={() => setOverlayOpen(false)}
        initialYear={initialYear}
      />
    </>
  );
}
