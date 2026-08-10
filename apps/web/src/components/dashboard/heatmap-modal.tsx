"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatedModal } from "@/components/motion/animated-modal";
import { ReviewHeatmap } from "@/components/dashboard/review-heatmap";
import { HeatmapSkeleton } from "@/components/ui/skeleton-patterns";
import { useReviewHeatmap } from "@/lib/client-cache/hooks/use-review-heatmap";

type Props = {
  open: boolean;
  onClose: () => void;
  initialYear: number;
};

const MIN_YEAR_OFFSET = 10;
const MAX_YEAR_OFFSET = 2;

export function HeatmapModal({ open, onClose, initialYear }: Props) {
  const currentYear = new Date().getFullYear();
  const minYear = currentYear - MIN_YEAR_OFFSET;
  const maxYear = currentYear + MAX_YEAR_OFFSET;
  const [year, setYear] = useState(initialYear);

  useEffect(() => {
    if (open) setYear(initialYear);
  }, [open, initialYear]);

  const { data: heatmap, isLoading } = useReviewHeatmap(year, open);

  const goPrev = useCallback(() => {
    setYear((y) => Math.max(minYear, y - 1));
  }, [minYear]);

  const goNext = useCallback(() => {
    setYear((y) => Math.min(maxYear, y + 1));
  }, [maxYear]);

  const yearControls = (
    <div style={s.yearNav} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={goPrev}
        disabled={year <= minYear}
        aria-label="Previous year"
      >
        <i className="ri-arrow-left-s-line" aria-hidden />
      </button>
      <span style={s.yearLabel}>{year}</span>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={goNext}
        disabled={year >= maxYear}
        aria-label="Next year"
      >
        <i className="ri-arrow-right-s-line" aria-hidden />
      </button>
    </div>
  );

  return (
    <AnimatedModal title="Activity" open={open} onClose={onClose} maxWidth={920}>
      {heatmap ? (
        <div style={{ opacity: isLoading ? 0.55 : 1, transition: "opacity 0.15s ease" }}>
          <ReviewHeatmap
            year={heatmap.year}
            counts={heatmap.counts}
            forecast={heatmap.forecast ?? {}}
            loading={isLoading}
            fitWidth
            embedded
            yearControls={yearControls}
          />
        </div>
      ) : (
        <HeatmapSkeleton />
      )}
    </AnimatedModal>
  );
}

const s: Record<string, React.CSSProperties> = {
  yearNav: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
  },
  yearLabel: {
    minWidth: 48,
    textAlign: "center",
    font: "600 14px/20px var(--font-sans)",
    color: "var(--ink-800)",
  },
};
