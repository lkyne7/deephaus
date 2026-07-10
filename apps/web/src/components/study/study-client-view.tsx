"use client";

import { FadeIn } from "@/components/motion/fade-in";
import { DashboardDecksTable } from "@/components/dashboard/dashboard-decks-table";
import { DecksSectionSkeleton } from "@/components/dashboard/dashboard-skeleton";
import { useDashboardStats } from "@/lib/client-cache/hooks/use-dashboard-stats";

export function StudyClientView() {
  const { data: stats } = useDashboardStats();

  if (!stats) {
    return <DecksSectionSkeleton />;
  }

  return (
    <FadeIn>
      <DashboardDecksTable decks={stats.per_deck} collapsible={false} />
    </FadeIn>
  );
}
