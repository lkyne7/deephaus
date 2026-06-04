"use client";

import { useCallback, useEffect, useState } from "react";
import { HeatmapPanelSkeleton } from "@/components/dashboard/dashboard-skeleton";
import { ReviewHeatmap } from "@/components/dashboard/review-heatmap";

type Props = {
  initialYear: number;
  availableYears: number[];
  onOpenStats: () => void;
};

export function ReviewHeatmapPanel({ initialYear, availableYears, onOpenStats }: Props) {
  const [year, setYear] = useState(initialYear);
  const [countsByYear, setCountsByYear] = useState<Record<number, Record<string, number>>>({});
  const [loadingYear, setLoadingYear] = useState<number | null>(initialYear);

  const loadYear = useCallback(async (targetYear: number) => {
    setLoadingYear(targetYear);
    try {
      const res = await fetch(`/api/stats/heatmap?year=${targetYear}`, { credentials: "include" });
      if (!res.ok) return;
      const json = (await res.json()) as { year: number; counts: Record<string, number> };
      setCountsByYear((prev) => ({ ...prev, [json.year]: json.counts }));
    } catch {
      // Heatmap is non-critical; skeleton stays until retry via year change.
    } finally {
      setLoadingYear((current) => (current === targetYear ? null : current));
    }
  }, []);

  useEffect(() => {
    if (countsByYear[initialYear] !== undefined) return;
    void loadYear(initialYear);
  }, [countsByYear, initialYear, loadYear]);

  const handleYearChange = useCallback(
    (nextYear: number) => {
      setYear(nextYear);
      if (countsByYear[nextYear] !== undefined) return;
      void loadYear(nextYear);
    },
    [countsByYear, loadYear],
  );

  const counts = countsByYear[year];
  const isLoading = counts === undefined || loadingYear === year;

  if (isLoading) {
    return (
      <div style={{ height: "100%", width: "100%", cursor: "pointer" }} onClick={onOpenStats}>
        <HeatmapPanelSkeleton />
      </div>
    );
  }

  return (
    <ReviewHeatmap
      year={year}
      counts={counts}
      availableYears={availableYears}
      onYearChange={handleYearChange}
      loading={loadingYear === year}
      fillHeight
      onOpenStats={onOpenStats}
    />
  );
}
