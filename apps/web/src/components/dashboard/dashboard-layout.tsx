"use client";

import { Fragment, useCallback, useMemo, useState, type ReactNode } from "react";
import { FadeIn } from "@/components/motion/fade-in";
import { AdvancedStatsModal } from "@/components/dashboard/advanced-stats-modal";
import type { AdvancedStatsDeckOption } from "@/components/dashboard/advanced-stats-modal";
import { DashboardCommunityPanel } from "@/components/dashboard/dashboard-community-panel";
import { DashboardSectionHeader } from "@/components/dashboard/dashboard-section-header";
import { OVERVIEW_PANEL_MIN_HEIGHT } from "@/components/dashboard/overview-panel-layout";
import { ReviewHeatmapPanel } from "@/components/dashboard/review-heatmap-panel";
import { PageHeaderSlot } from "@/components/page-header-context";
import type { TopbarMenuItem } from "@/components/topbar-more-menu";
import type { ReviewHeatmapData } from "@/lib/fsrs/stats";

type Props = {
  welcomeTitle: string;
  deckOptions: AdvancedStatsDeckOption[];
  heatmapYears: number[];
  seedHeatmap?: ReviewHeatmapData | null;
  overview: ReactNode;
  decks: ReactNode;
};

export function DashboardLayout({
  welcomeTitle,
  deckOptions,
  heatmapYears,
  seedHeatmap,
  overview,
  decks,
}: Props) {
  const currentYear = heatmapYears[0] ?? new Date().getFullYear();
  const [statsOpen, setStatsOpen] = useState(false);
  const [statsDeckId, setStatsDeckId] = useState<string | null>(null);

  const openStats = useCallback(() => {
    setStatsDeckId(null);
    setStatsOpen(true);
  }, []);

  const menuItems = useMemo<TopbarMenuItem[]>(
    () => [
      { id: "open-stats", label: "Open statistics", icon: "ri-line-chart-line", onClick: openStats },
      { id: "new-deck", label: "New deck", icon: "ri-add-line", href: "/decks/new" },
      { id: "import-deck", label: "Import deck", icon: "ri-folder-download-line", href: "/decks/import" },
    ],
    [openStats],
  );

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
      <PageHeaderSlot key="header-menu" menuItems={menuItems} />
      <section key="overview">
        <DashboardSectionHeader title={welcomeTitle} />

        <div style={s.overviewRow}>
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

          <div style={s.heatmapSlot}>
            <ReviewHeatmapPanel
              initialYear={currentYear}
              availableYears={heatmapYears}
              onOpenStats={openStats}
              seedHeatmap={seedHeatmap}
            />
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
