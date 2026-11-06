import { formatRelative } from "@/lib/fsrs/dashboard-decks";

export type DeckListInput = {
  deck_id: string;
  name: string;
  due: number;
  new: number;
  last_reviewed: string | null;
  total: number;
  new_card_count: number;
  is_community?: boolean;
  is_published?: boolean;
};

export type DeckListRow = {
  id: string;
  title: string;
  total: number;
  newCount: number;
  dueCount: number;
  /** Share of the deck that has been seen at least once, 0 to 1. */
  progress: number;
  lastReviewedRaw: string | null;
  isCommunity: boolean;
  isPublished: boolean;
};

export type DeckSortKey = "priority" | "name" | "progress" | "new" | "due" | "lastReviewed";
export type DeckSortDir = "asc" | "desc";
export type DeckSort = { key: DeckSortKey; dir: DeckSortDir };

export const DECK_SORT_OPTIONS: Array<{ value: DeckSortKey; label: string }> = [
  { value: "priority", label: "Priority" },
  { value: "name", label: "Name" },
  { value: "progress", label: "Progress" },
  { value: "new", label: "New" },
  { value: "due", label: "Due" },
  { value: "lastReviewed", label: "Last reviewed" },
];

export const DEFAULT_DECK_SORT: DeckSort = { key: "priority", dir: "desc" };

const DEFAULT_DIR: Record<DeckSortKey, DeckSortDir> = {
  priority: "desc",
  name: "asc",
  progress: "desc",
  new: "desc",
  due: "desc",
  lastReviewed: "desc",
};

export function defaultSortDir(key: DeckSortKey): DeckSortDir {
  return DEFAULT_DIR[key];
}

/** Picking the active sort again flips its direction. */
export function nextDeckSort(current: DeckSort, key: DeckSortKey): DeckSort {
  if (key === current.key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: DEFAULT_DIR[key] };
}

export function toDeckRow(deck: DeckListInput): DeckListRow {
  const progress =
    deck.total > 0
      ? Math.min(1, Math.max(0, (deck.total - deck.new_card_count) / deck.total))
      : 0;
  return {
    id: deck.deck_id,
    title: deck.name,
    total: deck.total,
    newCount: deck.new,
    dueCount: deck.due,
    progress,
    lastReviewedRaw: deck.last_reviewed,
    isCommunity: deck.is_community ?? false,
    isPublished: deck.is_published ?? false,
  };
}

function compareRows(a: DeckListRow, b: DeckListRow, key: DeckSortKey): number {
  switch (key) {
    case "name":
      return a.title.localeCompare(b.title);
    case "progress":
      return a.progress - b.progress;
    case "new":
      return a.newCount - b.newCount;
    case "due":
      return a.dueCount - b.dueCount;
    case "lastReviewed": {
      const av = a.lastReviewedRaw ? new Date(a.lastReviewedRaw).getTime() : 0;
      const bv = b.lastReviewedRaw ? new Date(b.lastReviewedRaw).getTime() : 0;
      return av - bv;
    }
    case "priority":
    default:
      return a.dueCount + a.newCount - (b.dueCount + b.newCount);
  }
}

export function visibleDeckRows(
  rows: DeckListRow[],
  query: string,
  sort: DeckSort,
): DeckListRow[] {
  const needle = query.trim().toLowerCase();
  const matches = needle
    ? rows.filter((row) => row.title.toLowerCase().includes(needle))
    : rows;
  return [...matches].sort((a, b) => {
    const cmp = compareRows(a, b, sort.key);
    return sort.dir === "asc" ? cmp : -cmp;
  });
}

/** "Reviewed 7d ago", "Reviewed Oct 21", or "Not reviewed yet". */
export function reviewedLabel(iso: string | null, now = new Date()): string {
  if (!iso) return "Not reviewed yet";
  const date = new Date(iso);
  const days = (now.getTime() - date.getTime()) / 86_400_000;
  if (days < 14) {
    const relative = formatRelative(iso) ?? "";
    return `Reviewed ${relative === "Just now" ? "just now" : relative}`;
  }
  const options: Intl.DateTimeFormatOptions =
    date.getFullYear() === now.getFullYear()
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" };
  return `Reviewed ${date.toLocaleDateString("en-US", options)}`;
}

export function cardCountLabel(total: number): string {
  return `${total.toLocaleString()} ${total === 1 ? "card" : "cards"}`;
}
