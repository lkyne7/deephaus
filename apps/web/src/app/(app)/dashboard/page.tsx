import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { DeckTable, type DeckRow } from "@/components/deck-table";
import { StatCards } from "@/components/stat-cards";
import { createClient } from "@/lib/supabase/server";
import { getDashboardStats } from "@/lib/fsrs/stats";
import { OPTIMIZER_MIN_LOGS } from "@/lib/fsrs/optimizer-config";

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

  // Render an empty state for unauthenticated users — middleware should keep
  // them on the auth flow, but guard anyway so the server query never throws.
  if (!user) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <div style={{ padding: 40 }}>Please sign in.</div>
      </>
    );
  }

  const stats = await getDashboardStats(supabase, user.id);

  const decks: DeckRow[] = stats.per_deck.map((d) => ({
    id: d.deck_id,
    title: d.name,
    newCount: d.new,
    dueCount: d.due,
    lastReviewed: formatRelative(d.last_reviewed),
  }));

  // Pick the most actionable deck for the "Study Now" button: prefer one with
  // due cards, fall back to one with new cards waiting.
  const studyDeck =
    stats.per_deck.find((d) => d.due > 0) ?? stats.per_deck.find((d) => d.new > 0) ?? null;

  return (
    <>
      <PageHeader
        title="Dashboard"
        action={
          <Link href="/decks/new" className="btn btn-primary">
            <i className="ri-add-line" />
            Create Deck
          </Link>
        }
      />
      <div style={{ padding: "32px 40px", display: "flex", flexDirection: "column", gap: 24 }}>
        <StatCards
          totalCards={stats.total_cards}
          breakdown={stats.state_breakdown}
          streak={stats.streak}
          dueCards={stats.due_now}
          newToday={stats.new_today_remaining}
          reviewedToday={stats.reviewed_today}
          retentionPct={stats.retention_pct}
          studyHref={studyDeck ? `/decks/${studyDeck.deck_id}/study` : undefined}
          lastOptimizedAt={stats.last_optimized_at}
          fsrsLogCount={stats.fsrs_log_count}
          optimizerReady={stats.fsrs_log_count >= OPTIMIZER_MIN_LOGS}
        />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ font: "500 20px/28px var(--font-sans)", color: "var(--ink-700)", margin: 0 }}>
            Decks ({decks.length})
          </h2>
          <Link href="/decks" style={{ color: "var(--teal-700)", font: "500 14px/20px var(--font-sans)" }}>
            View all <i className="ri-arrow-right-s-line" />
          </Link>
        </div>

        <DeckTable decks={decks.slice(0, 10)} />
      </div>
    </>
  );
}
