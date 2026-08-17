"use client";

import { useState } from "react";
import { CardStatePanelSkeleton } from "@/components/dashboard/dashboard-skeleton";
import { DashboardDecksTable } from "@/components/dashboard/dashboard-decks-table";
import { DashboardLayout } from "@/components/dashboard/dashboard-layout";
import { DashboardReadyPanel } from "@/components/dashboard/dashboard-ready-panel";
import { DecksSectionSkeleton } from "@/components/dashboard/dashboard-skeleton";
import { DeckOverviewModal } from "@/components/deck-overview-modal";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { useAppShellUser } from "@/lib/client-cache/user-context";
import { useDashboardStats } from "@/lib/client-cache/hooks/use-dashboard-stats";

function formatToday(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function DashboardClientView() {
  const { welcomeTitle, plan } = useAppShellUser();
  const { data: stats, error: statsError, mutate: retryStats } = useDashboardStats();
  const [overviewDeckId, setOverviewDeckId] = useState<string | null>(null);

  const currentYear = new Date().getFullYear();
  const heatmapYears = [currentYear, currentYear - 1];

  const deckOptions =
    stats?.per_deck.map((d) => ({ id: d.deck_id, title: d.name })) ?? [];

  const subtitle = stats
    ? `${formatToday()} · ${stats.total_cards.toLocaleString()} cards across ${stats.per_deck.length.toLocaleString()} deck${
        stats.per_deck.length === 1 ? "" : "s"
      }`
    : formatToday();

  const statsFailed = !stats && Boolean(statsError);

  const overview = stats ? (
    <DashboardReadyPanel
      cardsReady={stats.due_now + stats.new_today_remaining}
      reviewedToday={stats.reviewed_today}
      dueNow={stats.due_now}
      streak={stats.streak}
      retentionPct={stats.retention_pct}
      deckCount={stats.per_deck.length}
    />
  ) : statsFailed ? (
    <LoadErrorState label="your study overview" onRetry={() => void retryStats()} />
  ) : (
    <CardStatePanelSkeleton />
  );

  const decks = stats ? (
    <DashboardDecksTable decks={stats.per_deck} onDeckSelect={setOverviewDeckId} />
  ) : statsFailed ? (
    <LoadErrorState label="your decks" onRetry={() => void retryStats()} />
  ) : (
    <DecksSectionSkeleton />
  );

  return (
    <>
      <DashboardLayout
        welcomeTitle={welcomeTitle}
        subtitle={subtitle}
        deckOptions={deckOptions}
        heatmapYears={heatmapYears}
        showUpgradeCta={plan === "basic"}
        overview={overview}
        decks={decks}
      />
      <DeckOverviewModal
        deckId={overviewDeckId}
        onClose={() => setOverviewDeckId(null)}
      />
    </>
  );
}
