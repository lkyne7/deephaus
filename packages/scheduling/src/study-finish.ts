// What the end of a study session says about each deck (StudyFinishDeck in
// @deephaus/shared), worked out from the same deck summaries as every other
// count plus the reviews coming up by the end of tomorrow. Shared by the web
// API and the offline replica.
import type { ReviewOrderSettings, StudyFinishDeck } from "@deephaus/shared";

import { deckDayCounts, type DeckSummaryCounts } from "./daily-queue.js";
import { startOfStudyDay } from "./day-start.js";

export interface StudyDayBounds {
  start: Date;
  /** When the study day ends and the next begins. */
  end: Date;
  /** When the day after that ends. */
  endOfTomorrow: Date;
}

/** Today's and tomorrow's study days. Safe across a change of clocks. */
export function studyDayBounds(
  now: Date,
  dayStartHour: number,
  timeZone?: string | null,
): StudyDayBounds {
  const start = startOfStudyDay(now, dayStartHour, timeZone);
  const after = (hours: number) =>
    startOfStudyDay(new Date(start.getTime() + hours * 3_600_000), dayStartHour, timeZone);
  return { start, end: after(36), endOfTomorrow: after(60) };
}

/** A card not due yet but due by the end of tomorrow. */
export interface UpcomingReview {
  deckId: string;
  cardId: string;
  due: string;
  state: number;
  lastReview: string | null;
}

export interface FinishDeckSource {
  id: string;
  title: string;
  cardCount: number;
  paused: boolean;
  newCardsPerDay: number;
  reviewOrder: ReviewOrderSettings;
  summary: DeckSummaryCounts;
}

export function buildStudyFinishDecks(
  decks: readonly FinishDeckSource[],
  upcoming: readonly UpcomingReview[],
  bounds: StudyDayBounds,
): StudyFinishDeck[] {
  const byDeck = new Map<string, UpcomingReview[]>();
  for (const review of upcoming) {
    const list = byDeck.get(review.deckId);
    if (list) list.push(review);
    else byDeck.set(review.deckId, [review]);
  }
  const start = bounds.start.getTime();
  const end = bounds.end.getTime();

  return decks.map((deck) => {
    const counts = deckDayCounts(deck.summary, deck);
    const spaced = deck.reviewOrder.spaceOutSiblings;
    const newAvailable = spaced
      ? (deck.summary.new_cards_spaced ?? deck.summary.new_card_count)
      : deck.summary.new_card_count;

    let returning = 0;
    let returningAt: string | null = null;
    let dueTomorrow = 0;
    const aheadUnits: string[] = [];
    const studiedToday = new Set<string>();
    const reviews = byDeck.get(deck.id) ?? [];
    for (const review of reviews) {
      if (review.lastReview && Date.parse(review.lastReview) >= start) studiedToday.add(review.cardId);
    }
    for (const review of reviews) {
      const due = Date.parse(review.due);
      const laterToday = due < end;
      if (laterToday && (review.state === 1 || review.state === 3)) {
        returning += 1;
        if (!returningAt || due < Date.parse(returningAt)) returningAt = review.due;
        continue;
      }
      dueTomorrow += 1;
      const seenToday = review.lastReview != null && Date.parse(review.lastReview) >= start;
      if (review.state === 2 && !seenToday && !(spaced && studiedToday.has(review.cardId))) {
        aheadUnits.push(review.cardId);
      }
    }

    const cap = deck.reviewOrder.maxReviewsPerDay;
    const reviewsTomorrow = dueTomorrow + counts.reviewsHeldBack;
    const newTomorrow = Math.min(
      Math.max(0, deck.summary.new_card_count - counts.new),
      deck.newCardsPerDay,
    );
    return {
      id: deck.id,
      title: deck.title,
      paused: deck.paused,
      due: counts.due,
      new: counts.new,
      waiting: counts.due + counts.new,
      total: deck.cardCount,
      unseen: deck.summary.new_card_count,
      new_held_back: Math.max(0, newAvailable - counts.new),
      new_today: deck.summary.new_studied_today,
      new_limit: deck.newCardsPerDay,
      reviews_held_back: counts.reviewsHeldBack,
      review_limit: cap,
      returning,
      returning_at: returningAt,
      ahead: spaced ? new Set(aheadUnits).size : aheadUnits.length,
      tomorrow: (cap == null ? reviewsTomorrow : Math.min(cap, reviewsTomorrow)) + newTomorrow,
    };
  });
}
