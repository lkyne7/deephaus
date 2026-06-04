"use client";

import { Fragment, useCallback, useState, type ReactNode } from "react";
import { FadeIn } from "@/components/motion/fade-in";
import { NewDeckMenu } from "@/components/new-deck-menu";
import { AdvancedStatsModal } from "@/components/dashboard/advanced-stats-modal";
import type { AdvancedStatsDeckOption } from "@/components/dashboard/advanced-stats-modal";
import { DashboardCommunityPanel } from "@/components/dashboard/dashboard-community-panel";
import { DashboardSectionHeader } from "@/components/dashboard/dashboard-section-header";
import { OVERVIEW_PANEL_MIN_HEIGHT } from "@/components/dashboard/overview-panel-layout";
import { ReviewHeatmapPanel } from "@/components/dashboard/review-heatmap-panel";

type Props = {
  welcomeTitle: string;
  deckOptions: AdvancedStatsDeckOption[];
  hasDecksHint: boolean;
  heatmapYears: number[];
  overview: ReactNode;
  decks: ReactNode;
};

export function DashboardLayout({
  welcomeTitle,
  deckOptions,
  hasDecksHint,
  heatmapYears,
  overview,
  decks,
}: Props) {
  const currentYear = heatmapYears[0] ?? new Date().getFullYear();
  const [statsOpen, setStatsOpen] = useState(false);
  const [statsDeckId, setStatsDeckId] = useState<string | null>(null);

  const hasDecks = hasDecksHint || deckOptions.length > 0;

  const openStats = useCallback(() => {
    setStatsDeckId(null);
    setStatsOpen(true);
  }, []);

  return (
    <FadeIn
      style={
        {
          display: "flex",
          flexDirection: "column",
          gap: 28,
          ["--overview-panel-min-height" as string]: `${OVERVIEW_PANEL_MIN_HEIGHT}px`,
        } as React.CSSProperties
      }
    >
      <section key="overview">
        <DashboardSectionHeader
          title={welcomeTitle}
          trailing={hasDecks ? undefined : <NewDeckMenu size="sm" />}
        />

        <div style={s.overviewRow}>
          <div style={s.heatmapSlot}>
            <ReviewHeatmapPanel
              initialYear={currentYear}
              availableYears={heatmapYears}
              onOpenStats={openStats}
            />
          </div>

          <div
            style={s.cardSlot}
            onClick={openStats}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                openStats();
              }
            }}
            role="group"
            tabIndex={0}
            aria-label="Open statistics from study overview"
          >
            {overview}
          </div>
        </div>
      </section>

      <Fragment key="decks">{decks}</Fragment>

      <DashboardCommunityPanel key="community" />

      <AdvancedStatsModal
        key="stats-modal"
        open={statsOpen}
        onClose={() => setStatsOpen(false)}
        deckOptions={deckOptions}
        initialDeckId={statsDeckId}
      />
    </FadeIn>
  );
}

const s: Record<string, React.CSSProperties> = {
  overviewRow: {
    display: "flex",
    gap: 16,
    alignItems: "stretch",
    flexWrap: "wrap",
    minHeight: OVERVIEW_PANEL_MIN_HEIGHT,
  },
  heatmapSlot: {
    flex: 1,
    minWidth: 280,
    display: "flex",
    flexDirection: "column",
  },
  cardSlot: {
    flexShrink: 0,
    width: 248,
    display: "flex",
    flexDirection: "column",
    cursor: "pointer",
    outline: "none",
  },
};
