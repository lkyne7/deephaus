import { CardStatePanel } from "@/components/dashboard/card-state-panel";
import { getCachedDashboardOverviewStats } from "@/lib/fsrs/cached-stats";

export async function DashboardOverviewSection({ userId }: { userId: string }) {
  const stats = await getCachedDashboardOverviewStats(userId);

  return (
    <CardStatePanel
      totalCards={stats.total_cards}
      breakdown={stats.state_breakdown}
      streak={stats.streak}
      reviewedToday={stats.reviewed_today}
      cardsWaiting={stats.due_now + stats.new_today_remaining}
      retentionPct={stats.retention_pct}
    />
  );
}
