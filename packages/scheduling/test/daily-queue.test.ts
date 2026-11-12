import { describe, expect, it } from "vitest";
import { DEFAULT_REVIEW_ORDER, type ReviewOrderSettings } from "@deephaus/shared";

import {
  arrangeStudyQueue,
  deckDayCounts,
  placeNewCards,
  type ArrangeOptions,
} from "../src/daily-queue";
import type { StudyQueueItem } from "../src/study-queue";

const DAY = 86_400_000;
const now = Date.parse("2026-11-12T12:00:00.000Z");

function item(
  cardId: string,
  ord: number,
  state: 0 | 1 | 2 | 3,
  dueDaysAgo = 0,
  stability = 10,
): StudyQueueItem {
  const card = {
    id: cardId,
    type: ord > 0 ? "cloze" : "basic",
    front: null,
    back: null,
    cloze_text: null,
    extra: null,
    tags: [],
    sort_order: 0,
  };
  return {
    card,
    cloze_ord: ord > 0 ? ord : null,
    queue_key: `${cardId}:${ord}`,
    review:
      state === 0
        ? null
        : {
            card_id: cardId,
            cloze_ord: ord,
            due: new Date(now - dueDaysAgo * DAY).toISOString(),
            stability,
            difficulty: 5,
            elapsed_days: 0,
            scheduled_days: 0,
            reps: 3,
            lapses: 0,
            state,
            last_review: new Date(now - (dueDaysAgo + stability) * DAY).toISOString(),
            learning_steps: 0,
            suspended: false,
          },
  };
}

const options = (overrides: Partial<ArrangeOptions> = {}): ArrangeOptions => ({
  ...DEFAULT_REVIEW_ORDER,
  studiedToday: [],
  reviewsDoneToday: 0,
  newLimit: 20,
  seed: "2026-11-12",
  ...overrides,
});

const keys = (items: StudyQueueItem[]) => items.map((i) => i.queue_key);

describe("arrangeStudyQueue", () => {
  it("puts learning cards first, then reviews oldest due first, then new cards", () => {
    const due = [item("a", 0, 2, 1), item("b", 0, 3, 0), item("c", 0, 2, 5)];
    const fresh = [item("n", 0, 0)];
    const day = arrangeStudyQueue(due, fresh, options({ spaceOutSiblings: false }));
    expect(keys(day.ordered)).toEqual(["b:0", "c:0", "a:0", "n:0"]);
  });

  describe("spacing out siblings", () => {
    it("shows one gap of a card a day, a due review before a new gap", () => {
      const due = [item("x", 1, 2, 2), item("x", 2, 2, 1)];
      const fresh = [item("x", 3, 0), item("y", 1, 0), item("y", 2, 0)];
      const day = arrangeStudyQueue(due, fresh, options());
      expect(keys(day.ordered)).toEqual(["x:1", "y:1"]);
    });

    it("holds back a card's other gaps once one was studied today", () => {
      const due = [item("x", 2, 2, 1)];
      const fresh = [item("x", 3, 0), item("z", 1, 0)];
      const day = arrangeStudyQueue(due, fresh, options({
        studiedToday: [{ card_id: "x", cloze_ord: 1 }],
      }));
      expect(keys(day.ordered)).toEqual(["z:1"]);
    });

    it("never holds back a card being learned", () => {
      const due = [item("x", 1, 3, 0), item("x", 2, 1, 0)];
      const day = arrangeStudyQueue(due, [], options({
        studiedToday: [{ card_id: "x", cloze_ord: 1 }],
      }));
      expect(keys(day.ordered).sort()).toEqual(["x:1", "x:2"]);
    });

    it("applies the new-card limit after spacing, so the limit is still filled", () => {
      const fresh = [item("x", 1, 0), item("x", 2, 0), item("y", 1, 0), item("z", 1, 0)];
      const day = arrangeStudyQueue([], fresh, options({ newLimit: 2 }));
      expect(keys(day.newItems)).toEqual(["x:1", "y:1"]);
    });

    it("shows every gap when spacing is off", () => {
      const fresh = [item("x", 1, 0), item("x", 2, 0)];
      const day = arrangeStudyQueue([], fresh, options({ spaceOutSiblings: false }));
      expect(keys(day.ordered)).toEqual(["x:1", "x:2"]);
    });
  });

  describe("review cap", () => {
    it("keeps the first reviews in order, counting today's, and never caps learning", () => {
      const due = [
        item("a", 0, 2, 3),
        item("b", 0, 2, 2),
        item("c", 0, 2, 1),
        item("l", 0, 1, 0),
      ];
      const day = arrangeStudyQueue(due, [], options({ maxReviewsPerDay: 5, reviewsDoneToday: 3 }));
      expect(keys(day.ordered)).toEqual(["l:0", "a:0", "b:0"]);
      expect(day.reviewsHeldBack).toBe(1);
    });

    it("shows no reviews once today's cap is reached", () => {
      const day = arrangeStudyQueue([item("a", 0, 2, 1)], [], options({
        maxReviewsPerDay: 2,
        reviewsDoneToday: 4,
      }));
      expect(day.reviews).toEqual([]);
    });
  });

  describe("review sort order", () => {
    const due = [item("a", 0, 2, 1, 50), item("b", 0, 2, 4, 2), item("c", 0, 2, 2, 9)];

    it("orders by recall, lowest first", () => {
      const recall: Record<string, number> = { a: 0.88, b: 0.4, c: 0.7 };
      const day = arrangeStudyQueue(due, [], options({
        reviewSortOrder: "retrievability",
        retrievability: (i) => recall[i.card.id]!,
      }));
      expect(keys(day.ordered)).toEqual(["b:0", "c:0", "a:0"]);
    });

    it("shuffles the same way for the same day", () => {
      const first = arrangeStudyQueue(due, [], options({ reviewSortOrder: "random" }));
      const again = arrangeStudyQueue([...due].reverse(), [], options({ reviewSortOrder: "random" }));
      expect(keys(again.ordered)).toEqual(keys(first.ordered));
    });
  });
});

describe("placeNewCards", () => {
  const reviews = Array.from({ length: 10 }, (_, i) => item(`r${i}`, 0, 2));
  const fresh = [item("n0", 0, 0), item("n1", 0, 0)];

  it("spreads new cards evenly when mixed", () => {
    const placed = keys(placeNewCards(reviews, fresh, "mixed"));
    expect(placed.indexOf("n0:0")).toBe(3);
    expect(placed.indexOf("n1:0")).toBe(9);
    expect(placed).toHaveLength(12);
  });

  it("puts new cards first or last", () => {
    expect(keys(placeNewCards(reviews, fresh, "before")).slice(0, 2)).toEqual(["n0:0", "n1:0"]);
    expect(keys(placeNewCards(reviews, fresh, "after")).slice(-2)).toEqual(["n0:0", "n1:0"]);
  });
});

describe("deckDayCounts", () => {
  const order = (overrides: Partial<ReviewOrderSettings> = {}) => ({
    newCardsPerDay: 10,
    reviewOrder: { ...DEFAULT_REVIEW_ORDER, ...overrides },
  });
  const row = {
    due_count: 30,
    learning_due_count: 4,
    review_due_count: 26,
    review_due_cards_spaced: 20,
    new_card_count: 40,
    new_cards_spaced: 6,
    new_studied_today: 2,
    reviews_today: 15,
  };

  it("counts siblings spaced out", () => {
    expect(deckDayCounts(row, order())).toMatchObject({ due: 24, learning: 4, reviews: 20, new: 6 });
  });

  it("counts every gap without spacing", () => {
    expect(deckDayCounts(row, order({ spaceOutSiblings: false }))).toMatchObject({
      due: 30,
      new: 8,
    });
  });

  it("caps reviews by what is left of today's limit", () => {
    expect(deckDayCounts(row, order({ maxReviewsPerDay: 25 }))).toMatchObject({
      due: 14,
      reviews: 10,
      reviewsHeldBack: 10,
    });
  });

  it("falls back to the old counts for a summary without the split", () => {
    expect(
      deckDayCounts(
        { due_count: 30, new_card_count: 40, new_studied_today: 2 },
        order({ maxReviewsPerDay: 1 }),
      ),
    ).toMatchObject({ due: 30, new: 8 });
  });
});
