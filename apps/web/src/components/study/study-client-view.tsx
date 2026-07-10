"use client";

import { useState } from "react";
import { FadeIn } from "@/components/motion/fade-in";
import { DashboardDecksTable } from "@/components/dashboard/dashboard-decks-table";
import { DecksSectionSkeleton } from "@/components/dashboard/dashboard-skeleton";
import { DeckOverviewModal } from "@/components/deck-overview-modal";
import { useDashboardStats } from "@/lib/client-cache/hooks/use-dashboard-stats";

export function StudyClientView() {
  const { data: stats } = useDashboardStats();
  const [overviewDeckId, setOverviewDeckId] = useState<string | null>(null);

  if (!stats) {
    return <DecksSectionSkeleton />;
  }

  return (
    <FadeIn>
      <DashboardDecksTable
        decks={stats.per_deck}
        collapsible={false}
        title="Decks"
        showIcon={false}
        showCount={false}
        onDeckSelect={setOverviewDeckId}
      />
      <DeckOverviewModal
        deckId={overviewDeckId}
        onClose={() => setOverviewDeckId(null)}
      />
    </FadeIn>
  );
}
