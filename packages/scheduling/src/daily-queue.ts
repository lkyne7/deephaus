// How a deck lays out a study day under its review order and limits (see
// ReviewOrderSettings in @deephaus/shared). The queue builders (web API and
// the phone's offline replica) arrange cards with arrangeStudyQueue, and every
// count of today's work (Home, deck lists, reminders) goes through
// deckDayCounts, which applies the same rules to the deck summary's counts.
import type { ReviewOrderSettings } from "@deephaus/shared";

import type { StudyQueueItem } from "./study-queue.js";

/** A (card, gap) studied since the study day began. */
export type StudiedUnit = { card_id: string; cloze_ord: number };

export interface ArrangeOptions extends ReviewOrderSettings {
  /** Units with a review since the study day began. */
  studiedToday: Iterable<StudiedUnit>;
  /** Review cards (state review before grading) answered today in this deck. */
  reviewsDoneToday: number;
  /** Most new cards to keep, after spacing. */
  newLimit: number;
  /** Probability of recall now, for the "most likely forgotten first" order. */
  retrievability?: (item: StudyQueueItem) => number;
  /** Seeds the random order. Use the study day, so pages of one day agree. */
  seed: string;
}

export interface ArrangedQueue {
  /** Learning and relearning cards, soonest due first. Never held back. */
  learning: StudyQueueItem[];
  /** Due reviews in the deck's order, after spacing and the daily cap. */
  reviews: StudyQueueItem[];
  /** New cards in deck order, after spacing and the new-card limit. */
  newItems: StudyQueueItem[];
  /** The whole day in study order: learning first, then reviews and new cards placed as set. */
  ordered: StudyQueueItem[];
  /** Due reviews the daily cap left for another day. */
  reviewsHeldBack: number;
}

function isLearning(item: StudyQueueItem): boolean {
  const state = item.review?.state;
  return state === 1 || state === 3;
}

function unitOrd(item: StudyQueueItem): number {
  return item.review?.cloze_ord ?? item.cloze_ord ?? 0;
}

function dueMs(item: StudyQueueItem): number {
  const ms = item.review ? Date.parse(item.review.due) : Number.NaN;
  return Number.isFinite(ms) ? ms : 0;
}

/** Deterministic hash in [0, 1). Same seed and key, same place in the order. */
export function seededFraction(seed: string, key: string): number {
  const text = `${seed}:${key}`;
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  return (hash >>> 0) / 4294967296;
}

function sortReviews(reviews: StudyQueueItem[], options: ArrangeOptions): StudyQueueItem[] {
  const byDue = (a: StudyQueueItem, b: StudyQueueItem) => dueMs(a) - dueMs(b);
  if (options.reviewSortOrder === "random") {
    const rank = new Map(reviews.map((item) => [item, seededFraction(options.seed, item.queue_key)]));
    return [...reviews].sort((a, b) => rank.get(a)! - rank.get(b)! || byDue(a, b));
  }
  if (options.reviewSortOrder === "retrievability" && options.retrievability) {
    const recall = new Map(reviews.map((item) => [item, options.retrievability!(item)]));
    return [...reviews].sort((a, b) => recall.get(a)! - recall.get(b)! || byDue(a, b));
  }
  return [...reviews].sort(byDue);
}

/**
 * Places `newItems` among `reviews`. "mixed" spreads the two evenly, each
 * card going where it falls proportionally through its own list: with 10
 * reviews and 2 new cards, a new card follows the 3rd and the 8th review.
 */
export function placeNewCards(
  reviews: StudyQueueItem[],
  newItems: StudyQueueItem[],
  position: ReviewOrderSettings["newCardPosition"],
): StudyQueueItem[] {
  if (position === "before") return [...newItems, ...reviews];
  if (position === "after" || newItems.length === 0 || reviews.length === 0) {
    return [...reviews, ...newItems];
  }
  const out: StudyQueueItem[] = [];
  let r = 0;
  let n = 0;
  while (r < reviews.length || n < newItems.length) {
    const reviewAt = r < reviews.length ? (r + 0.5) / reviews.length : Number.POSITIVE_INFINITY;
    const newAt = n < newItems.length ? (n + 0.5) / newItems.length : Number.POSITIVE_INFINITY;
    if (reviewAt <= newAt) out.push(reviews[r++]!);
    else out.push(newItems[n++]!);
  }
  return out;
}

/**
 * One deck's study day. `due` holds every due learning and review unit,
 * `newItems` new units in deck order (more than the limit is fine).
 *
 * Spacing siblings: a card whose other gap was studied today shows no review
 * or new gap, and a card shows at most one of them (a due review before a new
 * gap). The review cap takes the first reviews in the chosen order, so with
 * "most likely forgotten first" the cap keeps the most urgent ones.
 */
export function arrangeStudyQueue(
  due: StudyQueueItem[],
  newItems: StudyQueueItem[],
  options: ArrangeOptions,
): ArrangedQueue {
  const learning = due.filter(isLearning).sort((a, b) => dueMs(a) - dueMs(b));
  let reviews = sortReviews(
    due.filter((item) => !isLearning(item)),
    options,
  );
  let fresh = newItems;

  if (options.spaceOutSiblings) {
    const studied = new Map<string, Set<number>>();
    for (const unit of options.studiedToday) {
      const ords = studied.get(unit.card_id) ?? new Set<number>();
      ords.add(unit.cloze_ord);
      studied.set(unit.card_id, ords);
    }
    const siblingStudied = (item: StudyQueueItem) => {
      const ords = studied.get(item.card.id);
      if (!ords) return false;
      const own = unitOrd(item);
      for (const ord of ords) if (ord !== own) return true;
      return false;
    };
    const shown = new Set<string>();
    const keep = (item: StudyQueueItem) => {
      if (siblingStudied(item) || shown.has(item.card.id)) return false;
      shown.add(item.card.id);
      return true;
    };
    reviews = reviews.filter(keep);
    fresh = fresh.filter(keep);
  }

  const cap = options.maxReviewsPerDay;
  const remaining = cap == null ? Number.POSITIVE_INFINITY : Math.max(0, cap - options.reviewsDoneToday);
  const reviewsHeldBack = Math.max(0, reviews.length - remaining);
  if (reviewsHeldBack > 0) reviews = reviews.slice(0, remaining);
  fresh = fresh.slice(0, Math.max(0, options.newLimit));

  return {
    learning,
    reviews,
    newItems: fresh,
    ordered: [...learning, ...placeNewCards(reviews, fresh, options.newCardPosition)],
    reviewsHeldBack,
  };
}

/** A deck's counts as get_study_deck_summaries (or its local mirror) returns them. */
export interface DeckSummaryCounts {
  due_count: number;
  new_card_count: number;
  new_studied_today: number;
  /** Missing from summaries made before review order existed. */
  learning_due_count?: number | null;
  review_due_count?: number | null;
  review_due_cards_spaced?: number | null;
  new_cards_spaced?: number | null;
  reviews_today?: number | null;
}

export interface DeckDayCounts {
  /** Learning plus review cards to study now. */
  due: number;
  learning: number;
  reviews: number;
  /** New cards left in today's budget that the deck can supply. */
  new: number;
  /** Due reviews the daily cap leaves for another day. */
  reviewsHeldBack: number;
}

/** Today's work in a deck, counted the way {@link arrangeStudyQueue} serves it. */
export function deckDayCounts(
  row: DeckSummaryCounts,
  settings: { newCardsPerDay: number; reviewOrder: ReviewOrderSettings },
): DeckDayCounts {
  const newSupply = Math.max(0, settings.newCardsPerDay - row.new_studied_today);
  const order = settings.reviewOrder;

  if (row.learning_due_count == null || row.review_due_count == null) {
    // An older summary can't tell learning from review cards: count as before.
    const fresh = Math.min(row.new_card_count, newSupply);
    return { due: row.due_count, learning: 0, reviews: row.due_count, new: fresh, reviewsHeldBack: 0 };
  }

  const learning = row.learning_due_count;
  const available = order.spaceOutSiblings
    ? (row.review_due_cards_spaced ?? row.review_due_count)
    : row.review_due_count;
  const cap = order.maxReviewsPerDay;
  const remaining = cap == null ? Number.POSITIVE_INFINITY : Math.max(0, cap - (row.reviews_today ?? 0));
  const reviews = Math.min(available, remaining);
  const newAvailable = order.spaceOutSiblings
    ? (row.new_cards_spaced ?? row.new_card_count)
    : row.new_card_count;

  return {
    due: learning + reviews,
    learning,
    reviews,
    new: Math.min(newAvailable, newSupply),
    reviewsHeldBack: available - reviews,
  };
}
