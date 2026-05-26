import { DashboardView } from "@/components/dashboard/dashboard-view";
import type { DeckGridRow } from "@/components/deck-grid";
import { createClient } from "@/lib/supabase/server";
import { getDashboardStats, getReviewHeatmap } from "@/lib/fsrs/stats";

export const dynamic = "force-dynamic";

function formatRelative(s: string | null) {
  if (!s) return null;
  const d = new Date(s);
  const diffMs = Date.now() - d.getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 14) return `${day}d ago`;
  return d.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes.user;

  if (!user) {
    return <div style={{ padding: 40 }}>Please sign in.</div>;
  }

  const currentYear = new Date().getFullYear();
  const heatmapYears = [currentYear, currentYear - 1];

  let stats;
  let heatmapByYear: Record<number, Record<string, number>> = {
    [currentYear]: {},
    [currentYear - 1]: {},
  };

  try {
    const [dashboardStats, ...heatmaps] = await Promise.all([
      getDashboardStats(supabase, user.id),
      ...heatmapYears.map((year) => getReviewHeatmap(supabase, user.id, year)),
    ]);
    stats = dashboardStats;
    heatmapByYear = Object.fromEntries(
      heatmaps.map((h) => [h.year, h.counts]),
    ) as Record<number, Record<string, number>>;
  } catch (err) {
    console.error("[dashboard]", err);
    return <div style={{ padding: 40, color: "var(--ink-700)" }}>Could not load dashboard stats. Please refresh the page.</div>;
  }

  const decks: DeckGridRow[] = stats.per_deck.map((d) => ({
    id: d.deck_id,
    title: d.name,
    newCount: d.new,
    dueCount: d.due,
    totalCount: d.total,
    lastReviewed: formatRelative(d.last_reviewed),
  }));

  const studyDecks = stats.per_deck.map((d) => ({
    id: d.deck_id,
    title: d.name,
    due: d.due,
    new: d.new,
    waiting: d.due + d.new,
  }));

  const defaultStudyDeck =
    stats.per_deck.find((d) => d.due > 0) ?? stats.per_deck.find((d) => d.new > 0) ?? null;

  return (
    <div style={{ padding: "32px 40px" }}>
      <DashboardView
          reviewedToday={stats.reviewed_today}
          retentionPct={stats.retention_pct}
          streak={stats.streak}
          dueNow={stats.due_now}
          newToday={stats.new_today_remaining}
          totalCards={stats.total_cards}
          stateBreakdown={stats.state_breakdown}
          studyDecks={studyDecks}
          defaultStudyDeckId={defaultStudyDeck?.deck_id ?? null}
          heatmapYear={currentYear}
          heatmapByYear={heatmapByYear}
          heatmapYears={heatmapYears}
          decks={decks}
        />
    </div>
  );
}
