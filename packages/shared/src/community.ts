/**
 * Community decks: the pieces the web app and the phone app must agree on.
 * Subjects a listing can be filed under, how the list is searched and sorted,
 * and the words used for counts, dates and topics.
 */

/** What listing, searching and sorting need to know about a published deck. */
export type CommunityListDeck = {
  title: string;
  description?: string | null;
  /** The publisher's username, when it could be looked up. */
  author?: string | null;
  subject?: string | null;
  card_count: number;
  subscriber_count: number;
  avg_rating?: number;
  rating_count?: number;
  published_at: string;
  /** When the cards last changed; older listings only have `published_at`. */
  content_updated_at?: string | null;
};

/** The subjects a published deck can be filed under, in the order they are shown. */
export const COMMUNITY_SUBJECTS = [
  { value: "medicine", label: "Medicine" },
  { value: "biology", label: "Biology" },
  { value: "chemistry", label: "Chemistry" },
  { value: "physics", label: "Physics" },
  { value: "maths", label: "Maths" },
  { value: "computing", label: "Computing" },
  { value: "languages", label: "Languages" },
  { value: "law", label: "Law" },
  { value: "history", label: "History" },
  { value: "psychology", label: "Psychology" },
  { value: "business", label: "Business" },
  { value: "other", label: "Other" },
] as const;

export type CommunitySubject = (typeof COMMUNITY_SUBJECTS)[number]["value"];

export const COMMUNITY_SUBJECT_VALUES = COMMUNITY_SUBJECTS.map((subject) => subject.value) as [
  CommunitySubject,
  ...CommunitySubject[],
];

const LABELS = new Map<string, string>(COMMUNITY_SUBJECTS.map((subject) => [subject.value, subject.label]));

export function subjectLabel(value: string | null | undefined): string | null {
  return value ? (LABELS.get(value) ?? null) : null;
}

export type CommunitySort = "subscribers" | "rating" | "newest";

export const DEFAULT_COMMUNITY_SORT: CommunitySort = "subscribers";

export const COMMUNITY_SORT_OPTIONS: Array<{ value: CommunitySort; label: string }> = [
  { value: "subscribers", label: "Most learners" },
  { value: "rating", label: "Top rated" },
  { value: "newest", label: "Recently updated" },
];

function bySubscribers(a: CommunityListDeck, b: CommunityListDeck): number {
  return b.subscriber_count - a.subscriber_count || b.card_count - a.card_count;
}

/** Unrated decks rank last: a 0 average means "no ratings", not "rated badly". */
function byRating(a: CommunityListDeck, b: CommunityListDeck): number {
  const aCount = a.rating_count ?? 0;
  const bCount = b.rating_count ?? 0;
  if (aCount > 0 !== bCount > 0) return aCount > 0 ? -1 : 1;
  return (b.avg_rating ?? 0) - (a.avg_rating ?? 0) || bCount - aCount || bySubscribers(a, b);
}

/** When the cards last changed; listings from before that was recorded fall back to the publish date. */
export function contentUpdatedAt(deck: CommunityListDeck): string {
  return deck.content_updated_at ?? deck.published_at;
}

function byNewest(a: CommunityListDeck, b: CommunityListDeck): number {
  return Date.parse(contentUpdatedAt(b)) - Date.parse(contentUpdatedAt(a)) || bySubscribers(a, b);
}

const COMPARATORS: Record<CommunitySort, (a: CommunityListDeck, b: CommunityListDeck) => number> = {
  subscribers: bySubscribers,
  rating: byRating,
  newest: byNewest,
};

export function sortCommunityDecks<T extends CommunityListDeck>(decks: T[], sort: CommunitySort): T[] {
  return [...decks].sort(COMPARATORS[sort]);
}

function matches(deck: CommunityListDeck, needle: string): boolean {
  return [deck.title, deck.description, deck.author].some((text) => text?.toLowerCase().includes(needle));
}

/** The decks to list: matching the search (title, description or author) and subject, in order. */
export function visibleCommunityDecks<T extends CommunityListDeck>(
  decks: T[],
  { query, sort, subject }: { query: string; sort: CommunitySort; subject?: string },
): T[] {
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

/** "1 learner", "1,820 learners": people who have added a published deck. */
export function learnerLabel(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? "learner" : "learners"}`;
}

export function countLabel(count: number, noun: string): string {
  return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
}

const TYPE_NOUNS: Record<string, string> = {
  basic: "front and back",
  cloze: "cloze",
  "image-occlusion": "image",
};

/** "300 front and back · 112 cloze" from cards-per-type counts. */
export function cardTypeCountsLabel(types: Record<string, number>): string {
  return ["basic", "cloze", "image-occlusion"]
    .filter((type) => (types[type] ?? 0) > 0)
    .map((type) => `${types[type]!.toLocaleString()} ${TYPE_NOUNS[type]}`)
    .join(" · ");
}

/** Tags an importer adds for bookkeeping, such as "PDF::Page12"; they say nothing about the subject. */
const HOUSEKEEPING_TAG = /^(pdf|page|slide|notes?[ _-]?chunk)\W*\d*$/i;

/**
 * A deck's tags as topics to show: the last part of a nested tag
 * ("Gastrointestinal::Pancreatitis" becomes "Pancreatitis"), without page
 * markers or repeats, most used first.
 */
export function topicLabels(tags: string[], limit = 6): string[] {
  const seen = new Set<string>();
  const topics: string[] = [];
  for (const tag of tags) {
    const parts = tag.split("::").map((part) => part.trim()).filter(Boolean);
    const label = parts[parts.length - 1];
    if (!label || HOUSEKEEPING_TAG.test(label)) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    topics.push(label);
    if (topics.length === limit) break;
  }
  return topics;
}
