import type { CommunityDeckRow } from "@/lib/community/types";

export type CommunitySort = "subscribers" | "rating" | "newest";

export const DEFAULT_COMMUNITY_SORT: CommunitySort = "subscribers";

export const COMMUNITY_SORT_OPTIONS: Array<{ value: CommunitySort; label: string }> = [
  { value: "subscribers", label: "Most learners" },
  { value: "rating", label: "Top rated" },
  { value: "newest", label: "Recently updated" },
];

function bySubscribers(a: CommunityDeckRow, b: CommunityDeckRow): number {
  return b.subscriber_count - a.subscriber_count || b.card_count - a.card_count;
}

/** Unrated decks rank last: a 0 average means "no ratings", not "rated badly". */
function byRating(a: CommunityDeckRow, b: CommunityDeckRow): number {
  const aRated = a.rating_count > 0;
  const bRated = b.rating_count > 0;
  if (aRated !== bRated) return aRated ? -1 : 1;
  return b.avg_rating - a.avg_rating || b.rating_count - a.rating_count || bySubscribers(a, b);
}

/** When the cards last changed; listings from before that was recorded fall back to the publish date. */
export function contentUpdatedAt(deck: CommunityDeckRow): string {
  return deck.content_updated_at ?? deck.published_at;
}

function byNewest(a: CommunityDeckRow, b: CommunityDeckRow): number {
  return Date.parse(contentUpdatedAt(b)) - Date.parse(contentUpdatedAt(a)) || bySubscribers(a, b);
}

const COMPARATORS: Record<CommunitySort, (a: CommunityDeckRow, b: CommunityDeckRow) => number> = {
  subscribers: bySubscribers,
  rating: byRating,
  newest: byNewest,
};

export function sortCommunityDecks(decks: CommunityDeckRow[], sort: CommunitySort): CommunityDeckRow[] {
  return [...decks].sort(COMPARATORS[sort]);
}

function matches(deck: CommunityDeckRow, needle: string): boolean {
  return [deck.title, deck.description, deck.author].some((text) => text?.toLowerCase().includes(needle));
}

/** The decks to list: matching the search (title, description or author) and subject, in order. */
export function visibleCommunityDecks(
  decks: CommunityDeckRow[],
  { query, sort, subject }: { query: string; sort: CommunitySort; subject?: string },
): CommunityDeckRow[] {
  const needle = query.trim().toLowerCase();
  return sortCommunityDecks(
    decks.filter(
      (deck) => (!needle || matches(deck, needle)) && (!subject || deck.subject === subject),
    ),
    sort,
  );
}

/** "today", "3 days ago", "Oct 28": how long since the cards last changed. */
export function updatedLabel(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const days = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
  if (days <= 0) return "Updated today";
  if (days === 1) return "Updated yesterday";
  if (days < 14) return `Updated ${days} days ago`;
  const options: Intl.DateTimeFormatOptions =
    date.getFullYear() === now.getFullYear()
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" };
  return `Updated ${date.toLocaleDateString("en-US", options)}`;
}
