"use client";

import {
  cloneElement,
  Fragment,
  isValidElement,
  useCallback,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { FadeIn } from "@/components/motion/fade-in";
import { AnkiImportOverlay } from "@/components/anki-import-overlay";
import type { DeckImportMode } from "@/components/deck-import-view";
import { AdvancedStatsModal } from "@/components/dashboard/advanced-stats-modal";
import type { AdvancedStatsDeckOption } from "@/components/dashboard/advanced-stats-modal";
import { DashboardReadyPanel } from "@/components/dashboard/dashboard-ready-panel";
import { OVERVIEW_PANEL_MIN_HEIGHT } from "@/components/dashboard/overview-panel-layout";
import { LeaderboardPanel } from "@/components/dashboard/leaderboard-panel";
import { DashboardUpgradeButton } from "@/components/dashboard/dashboard-upgrade-button";
import { NewDeckMenu } from "@/components/new-deck-menu";
import { ReviewHeatmapPanel } from "@/components/dashboard/review-heatmap-panel";
import { PageHeaderSlot } from "@/components/page-header-context";
import type { TopbarMenuItem } from "@/components/topbar-more-menu";
import type { ReviewHeatmapData } from "@/lib/fsrs/stats";

type Props = {
  welcomeTitle: string;
  subtitle: string;
  deckOptions: AdvancedStatsDeckOption[];
  heatmapYears: number[];
  seedHeatmap?: ReviewHeatmapData | null;
  showUpgradeCta?: boolean;
  overview: ReactNode;
  decks: ReactNode;
};

export function DashboardLayout({
  welcomeTitle,
  subtitle,
  deckOptions,
  heatmapYears,
  seedHeatmap,
  showUpgradeCta = false,
  overview,
  decks,
}: Props) {
  const currentYear = heatmapYears[0] ?? new Date().getFullYear();
  const [statsOpen, setStatsOpen] = useState(false);
  const [statsDeckId, setStatsDeckId] = useState<string | null>(null);
  const [deckImportOpen, setDeckImportOpen] = useState(false);
  const [deckImportMode, setDeckImportMode] = useState<DeckImportMode>("anki");

  const openStats = useCallback(() => {
    setStatsDeckId(null);
    setStatsOpen(true);
  }, []);

  const openDeckImport = useCallback((mode: DeckImportMode = "anki") => {
    setDeckImportMode(mode);
    setDeckImportOpen(true);
  }, []);

  const menuItems = useMemo<TopbarMenuItem[]>(
    () => [
      ...(showUpgradeCta
        ? [
            {
              id: "upgrade",
              label: "Upgrade to Plus or Pro",
              icon: "ri-vip-crown-line",
              href: "/dashboard?settings=billing",
            } satisfies TopbarMenuItem,
          ]
        : []),
      { id: "open-stats", label: "Open statistics", icon: "ri-line-chart-line", onClick: openStats },
      { id: "new-deck", label: "New deck", icon: "ri-add-line", href: "/create" },
      { id: "import-anki", label: "Import from Anki", icon: "ri-folder-download-line", onClick: () => openDeckImport("anki") },
      { id: "import-quizlet", label: "Import from Quizlet", icon: "ri-file-copy-2-line", onClick: () => openDeckImport("quizlet") },
    ],
    [openStats, openDeckImport, showUpgradeCta],
  );

  // Inject the stats opener into the ready panel so the whole card is clickable.
  const overviewNode =
    isValidElement(overview) && overview.type === DashboardReadyPanel
      ? cloneElement(overview as ReactElement<{ onOpenStats?: () => void }>, {
          onOpenStats: openStats,
        })
      : overview;

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
        <div style={s.pageHeader}>
          <div style={{ minWidth: 0 }}>
            <h1 style={s.pageTitle}>{welcomeTitle}</h1>
            <p style={s.pageSubtitle}>{subtitle}</p>
          </div>
          <div style={s.headerActions}>
            {showUpgradeCta ? <DashboardUpgradeButton /> : null}
            <NewDeckMenu buttonLabel="Create Deck" showButtonIcon={false} onImport={openDeckImport} />
          </div>
        </div>

        <div style={s.overviewRow}>
          <div style={s.readySlot}>{overviewNode}</div>

          <div style={s.heatmapSlot}>
            <ReviewHeatmapPanel
              initialYear={currentYear}
              seedHeatmap={seedHeatmap}
            />
          </div>

          <div style={s.leaderboardSlot}>
            <LeaderboardPanel />
          </div>
        </div>
      </section>

      <Fragment key="decks">{decks}</Fragment>

      <AdvancedStatsModal
        key="stats-modal"
        open={statsOpen}
        onClose={() => setStatsOpen(false)}
        deckOptions={deckOptions}
        initialDeckId={statsDeckId}
      />

      <AnkiImportOverlay
        open={deckImportOpen}
        initialMode={deckImportMode}
        onClose={() => setDeckImportOpen(false)}
        backLabel="Close"
      />
    </FadeIn>
  );
}

const s: Record<string, React.CSSProperties> = {
  pageHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    flexWrap: "wrap",
    marginBottom: 20,
  },
  pageTitle: {
    margin: 0,
    font: "600 26px/32px var(--font-sans)",
    letterSpacing: "-0.02em",
    color: "var(--ink-900)",
  },
  pageSubtitle: {
    margin: "6px 0 0",
    font: "400 14px/20px var(--font-sans)",
    color: "var(--fg-4)",
  },
  headerActions: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  overviewRow: {
    display: "flex",
    gap: 16,
    alignItems: "stretch",
    flexWrap: "wrap",
    minHeight: OVERVIEW_PANEL_MIN_HEIGHT,
  },
  // Grow factors keep the 1 : 1.35 : 0.85 desktop ratio but are scaled so each
  // is >= 1 — a factor below 1 only claims that fraction of the free space, so
  // a wrapped tile would stop short of the row's full width.
  readySlot: {
    flex: "1.18 1 340px",
    minWidth: 280,
    display: "flex",
    flexDirection: "column",
  },
  heatmapSlot: {
    flex: "1.59 1 440px",
    minWidth: 280,
    display: "flex",
    flexDirection: "column",
  },
  leaderboardSlot: {
    flex: "1 1 240px",
    minWidth: 240,
    display: "flex",
    flexDirection: "column",
  },
};
