import { pickFeaturedDecks } from "@/lib/community/load-community-decks";
import type { CommunityDeckRow } from "@/lib/community/types";

export type CommunitySort = "subscribers" | "rating" | "newest";

export const DEFAULT_COMMUNITY_SORT: CommunitySort = "subscribers";

export const COMMUNITY_SORT_OPTIONS: Array<{ value: CommunitySort; label: string }> = [
  { value: "subscribers", label: "Most subscribed" },
  { value: "rating", label: "Top rated" },
  { value: "newest", label: "Newest" },
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

function byNewest(a: CommunityDeckRow, b: CommunityDeckRow): number {
  return Date.parse(b.published_at) - Date.parse(a.published_at) || bySubscribers(a, b);
}

const COMPARATORS: Record<CommunitySort, (a: CommunityDeckRow, b: CommunityDeckRow) => number> = {
  subscribers: bySubscribers,
  rating: byRating,
  newest: byNewest,
};

export function sortCommunityDecks(decks: CommunityDeckRow[], sort: CommunitySort): CommunityDeckRow[] {
  return [...decks].sort(COMPARATORS[sort]);
}

export type CommunityListing = {
  /** Every deck matching the search, in sort order. */
  all: CommunityDeckRow[];
  /** Spotlight picks; empty unless the Featured section should show. */
  featured: CommunityDeckRow[];
  /** `all` without the spotlight picks. */
  rest: CommunityDeckRow[];
};

/**
 * Featured only shows while browsing the default order: a search or another
 * sort has to show its full result, and on the default order the picks are
 * the head of the list, so the list continues where they stop.
 */
export function buildCommunityListing(
  decks: CommunityDeckRow[],
  { query, sort, featuredCount }: { query: string; sort: CommunitySort; featuredCount: number },
): CommunityListing {
  const needle = query.trim().toLowerCase();
  const matches = needle ? decks.filter((d) => d.title.toLowerCase().includes(needle)) : decks;
  const all = sortCommunityDecks(matches, sort);

  const browsing = needle === "" && sort === DEFAULT_COMMUNITY_SORT;
  const featured =
    browsing && decks.length > featuredCount ? pickFeaturedDecks(decks, featuredCount) : [];
  const featuredIds = new Set(featured.map((d) => d.id));

  return { all, featured, rest: all.filter((d) => !featuredIds.has(d.id)) };
}
