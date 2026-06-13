"use client";

import { CardStatePanel } from "@/components/dashboard/card-state-panel";
import { CardStatePanelSkeleton } from "@/components/dashboard/dashboard-skeleton";
import { DashboardLayout } from "@/components/dashboard/dashboard-layout";
import { DashboardSectionHeader } from "@/components/dashboard/dashboard-section-header";
import { DeckGrid } from "@/components/deck-grid";
import { DecksSectionSkeleton } from "@/components/dashboard/dashboard-skeleton";
import { useAppShellUser } from "@/lib/client-cache/user-context";
import { useDashboardStats } from "@/lib/client-cache/hooks/use-dashboard-stats";
import { topDashboardDeckRows } from "@/lib/fsrs/dashboard-decks";

export function DashboardClientView() {
  const { welcomeTitle } = useAppShellUser();
  const { data: stats } = useDashboardStats();

  const currentYear = new Date().getFullYear();
  const heatmapYears = [currentYear, currentYear - 1];

  const deckOptions =
    stats?.per_deck.map((d) => ({ id: d.deck_id, title: d.name })) ?? [];
  const hasDecks = deckOptions.length > 0;

  const overview = stats ? (
      <CardStatePanel
        totalCards={stats.total_cards}
        breakdown={stats.state_breakdown}
        streak={stats.streak}
        reviewedToday={stats.reviewed_today}
        cardsWaiting={stats.due_now + stats.new_today_remaining}
        retentionPct={stats.retention_pct}
      />
    ) : (
      <CardStatePanelSkeleton />
    );

  const decks = stats ? (
      <section>
        <DashboardSectionHeader
          title="Your decks"
          icon="ri-folder-3-line"
          count={stats.per_deck.length}
          action={hasDecks ? { kind: "link", href: "/study", label: "View all" } : undefined}
        />
        <DeckGrid decks={topDashboardDeckRows(stats.per_deck)} singleRow />
      </section>
    ) : (
      <DecksSectionSkeleton />
    );

  return (
    <DashboardLayout
      welcomeTitle={welcomeTitle}
      deckOptions={deckOptions}
      heatmapYears={heatmapYears}
      overview={overview}
      decks={decks}
    />
  );
}
