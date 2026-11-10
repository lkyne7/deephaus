import type { DashboardStats, StudyDeckOption } from "@deephaus/api-client";

export type DeckStatus = "study" | "caught-up" | "empty" | "paused";

/** One deck as the Decks list shows it: today's work, what it holds and how far along it is. */
export type DeckRow = {
  id: string;
  title: string;
  /** Cards due for review now. */
  due: number;
  /** New cards available today. */
  fresh: number;
  waiting: number;
  total: number;
  /** Share of the deck's cards that have been studied at least once; null when unknown. */
  seenShare: number | null;
  lastReviewed: string | null;
  isCommunity: boolean;
  isPublished: boolean;
  paused: boolean;
  status: DeckStatus;
};

export type DeckFilter = "all" | "study" | "paused";
export type DeckSort = "name" | "due" | "recent";

/**
 * The deck list joined with the dashboard's per-deck numbers. The list says
 * what is due; the stats add each deck's size, progress and last review.
 */
export function toDeckRows(decks: StudyDeckOption[], stats: DashboardStats | null): DeckRow[] {
  const byId = new Map((stats?.per_deck ?? []).map((deck) => [deck.deck_id, deck]));
  return decks.map((deck) => {
    const stat = byId.get(deck.id);
    const total = stat?.total ?? deck.due + deck.new + deck.waiting;
    const unseen = stat?.new_card_count;
    const paused = deck.paused ?? stat?.paused ?? false;
    return {
      id: deck.id,
      title: deck.title,
      due: deck.due,
      fresh: deck.new,
      waiting: deck.waiting,
      total,
      seenShare: unseen != null && total > 0 ? Math.max(0, Math.min(1, (total - unseen) / total)) : null,
      lastReviewed: stat?.last_reviewed ?? null,
      isCommunity: deck.is_community ?? stat?.is_community ?? false,
      isPublished: deck.is_published ?? stat?.is_published ?? false,
      paused,
      status: paused ? "paused" : total === 0 ? "empty" : deck.due + deck.new > 0 ? "study" : "caught-up",
    };
  });
}

/** "Reviewed today", "Reviewed 7d ago", "Reviewed Oct 21" or "Not reviewed yet". */
export function reviewedLabel(iso: string | null, now = new Date()): string {
  if (!iso) return "Not reviewed yet";
  const date = new Date(iso);
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return "Reviewed just now";
  if (minutes < 60) return `Reviewed ${minutes}m ago`;
  if (minutes < 24 * 60) return `Reviewed ${Math.floor(minutes / 60)}h ago`;
  const days = Math.floor(minutes / (24 * 60));
  if (days < 14) return `Reviewed ${days}d ago`;
  const options: Intl.DateTimeFormatOptions =
    date.getFullYear() === now.getFullYear()
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" };
  return `Reviewed ${date.toLocaleDateString("en-US", options)}`;
}

/** "412 cards · From Community": the deck's size, then where it came from or when it was last studied. */
export function deckMetaLine(row: DeckRow, now = new Date()): string {
  if (row.total === 0) return "No cards yet";
  const count = `${row.total.toLocaleString()} ${row.total === 1 ? "card" : "cards"}`;
  const origin = row.isCommunity
    ? "From Community"
    : row.isPublished
      ? "Published"
      : reviewedLabel(row.lastReviewed, now);
  return `${count} · ${origin}`;
}

/** "30% of cards seen", for the progress bar's label. */
export function seenLabel(row: DeckRow): string | null {
  if (row.seenShare == null) return null;
  if (row.seenShare >= 1) return "All cards seen";
  if (row.seenShare <= 0) return "No cards seen yet";
  return `${Math.max(1, Math.min(99, Math.round(row.seenShare * 100)))}% of cards seen`;
}

const byName = (a: DeckRow, b: DeckRow) =>
  a.title.localeCompare(b.title, undefined, { sensitivity: "base" });

/** Paused and empty decks sit below the ones with something to do. */
function rank(row: DeckRow): number {
  return row.status === "paused" ? 2 : row.status === "empty" ? 1 : 0;
}

/** The decks to list: matching the search and filter, in the chosen order. */
export function visibleDeckRows(
  rows: DeckRow[],
  { query, filter, sort }: { query: string; filter: DeckFilter; sort: DeckSort },
): DeckRow[] {
  const needle = query.trim().toLocaleLowerCase();
  const shown = rows.filter((row) => {
    if (filter === "study" && row.status !== "study") return false;
    if (filter === "paused" && !row.paused) return false;
    return !needle || row.title.toLocaleLowerCase().includes(needle);
  });
  if (sort === "name") return shown.sort(byName);
  if (sort === "recent") {
    return shown.sort(
      (a, b) => (b.lastReviewed ?? "").localeCompare(a.lastReviewed ?? "") || byName(a, b),
    );
  }
  return shown.sort(
    (a, b) => rank(a) - rank(b) || b.due - a.due || b.fresh - a.fresh || byName(a, b),
  );
}
