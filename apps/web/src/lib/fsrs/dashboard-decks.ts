import type { DashboardDeckRow } from "@/lib/fsrs/dashboard-metrics";

export const DASHBOARD_DECK_ROW_LIMIT = 4;

export type DashboardDeckGridRow = {
  id: string;
  title: string;
  newCount: number;
  dueCount: number;
  totalCount: number;
  lastReviewed: string | null;
};

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

export function deckRowsFromPerDeck(perDeck: DashboardDeckRow[]): DashboardDeckGridRow[] {
  return perDeck.map((d) => ({
    id: d.deck_id,
    title: d.name,
    newCount: d.new,
    dueCount: d.due,
    totalCount: d.total,
    lastReviewed: formatRelative(d.last_reviewed),
  }));
}

/** Top decks by cards waiting (due + new), capped for the dashboard row. */
export function topDashboardDeckRows(
  perDeck: DashboardDeckRow[],
  limit = DASHBOARD_DECK_ROW_LIMIT,
): DashboardDeckGridRow[] {
  return deckRowsFromPerDeck(perDeck)
    .sort((a, b) => b.dueCount + b.newCount - (a.dueCount + a.newCount))
    .slice(0, limit);
}
