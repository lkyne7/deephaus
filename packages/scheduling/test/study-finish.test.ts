import { describe, expect, it } from "vitest";
import { DEFAULT_REVIEW_ORDER } from "@deephaus/shared";

import { arrangeStudyAhead } from "../src/daily-queue";
import { buildStudyFinishDecks, studyDayBounds, type FinishDeckSource } from "../src/study-finish";
import type { StudyQueueItem } from "../src/study-queue";

const bounds = studyDayBounds(new Date("2026-11-25T18:00:00.000Z"), 4, "UTC");

function deck(overrides: Partial<FinishDeckSource> = {}): FinishDeckSource {
  return {
    id: "a",
    title: "Biochemistry",
    cardCount: 100,
    paused: false,
    newCardsPerDay: 20,
    reviewOrder: DEFAULT_REVIEW_ORDER,
    summary: {
      due_count: 0,
      new_card_count: 35,
      new_studied_today: 20,
      learning_due_count: 0,
      review_due_count: 0,
      review_due_cards_spaced: 0,
      new_cards_spaced: 35,
      reviews_today: 0,
    },
    ...overrides,
  };
}

function review(cardId: string, due: string, state: number, lastReview: string | null = null) {
  return { deckId: "a", cardId, due, state, lastReview };
}

describe("studyDayBounds", () => {
  it("runs from today's rollover to the end of tomorrow", () => {
    expect(bounds.start.toISOString()).toBe("2026-11-25T04:00:00.000Z");
    expect(bounds.end.toISOString()).toBe("2026-11-26T04:00:00.000Z");
    expect(bounds.endOfTomorrow.toISOString()).toBe("2026-11-27T04:00:00.000Z");
  });

  it("keeps the rollover hour across a change of clocks", () => {
    const fall = studyDayBounds(new Date("2026-10-31T18:00:00.000Z"), 4, "America/New_York");
    expect(fall.end.toISOString()).toBe("2026-11-01T09:00:00.000Z");
    expect(fall.start.toISOString()).toBe("2026-10-31T08:00:00.000Z");
  });
});

describe("buildStudyFinishDecks", () => {
  it("counts new cards the limit holds back, and tomorrow's share of them", () => {
    const [row] = buildStudyFinishDecks([deck()], [], bounds);
    expect(row).toMatchObject({ waiting: 0, unseen: 35, new_held_back: 35, new_today: 20, tomorrow: 20 });
  });

  it("separates cards coming back today from tomorrow's, and finds the first", () => {
    const [row] = buildStudyFinishDecks(
      [deck({ summary: { ...deck().summary, new_card_count: 0, new_cards_spaced: 0 } })],
      [
        review("l1", "2026-11-25T20:00:00.000Z", 3, "2026-11-25T17:00:00.000Z"),
        review("l2", "2026-11-25T19:00:00.000Z", 1, "2026-11-25T17:00:00.000Z"),
        review("r1", "2026-11-26T12:00:00.000Z", 2, "2026-11-20T12:00:00.000Z"),
        // Learned today and due tomorrow: part of tomorrow, no use doing ahead.
        review("r2", "2026-11-26T12:00:00.000Z", 2, "2026-11-25T17:00:00.000Z"),
      ],
      bounds,
    );
    expect(row).toMatchObject({
      returning: 2,
      returning_at: "2026-11-25T19:00:00.000Z",
      ahead: 1,
      tomorrow: 2,
    });
  });

  it("reports reviews past the daily limit and caps tomorrow with it", () => {
    const [row] = buildStudyFinishDecks(
      [
        deck({
          reviewOrder: { ...DEFAULT_REVIEW_ORDER, maxReviewsPerDay: 100 },
          summary: {
            ...deck().summary,
            new_card_count: 0,
            new_cards_spaced: 0,
            review_due_count: 116,
            review_due_cards_spaced: 116,
            reviews_today: 100,
          },
        }),
      ],
      [],
      bounds,
    );
    expect(row).toMatchObject({ waiting: 0, reviews_held_back: 116, review_limit: 100, tomorrow: 100 });
  });
});

describe("arrangeStudyAhead", () => {
  const item = (id: string, ord: number, state: 1 | 2 = 2): StudyQueueItem => ({
    card: {
      id,
      type: ord ? "cloze" : "basic",
      front: null,
      back: null,
      cloze_text: null,
      extra: null,
      tags: [],
      sort_order: 0,
    },
    cloze_ord: ord || null,
    queue_key: `${id}:${ord}`,
    review: {
      card_id: id,
      cloze_ord: ord,
      due: "2026-11-26T12:00:00.000Z",
      stability: 5,
      difficulty: 5,
      elapsed_days: 1,
      scheduled_days: 2,
      reps: 2,
      lapses: 0,
      state,
      last_review: "2026-11-20T12:00:00.000Z",
      learning_steps: 0,
      suspended: false,
    },
  });

  it("puts the card closest to forgotten first and leaves out today's and learning cards", () => {
    const recall = new Map([["a:0", 0.95], ["b:0", 0.9], ["c:0", 0.99]]);
    const order = arrangeStudyAhead([item("a", 0), item("b", 0), item("c", 0), item("d", 0, 1)], {
      spaceOutSiblings: true,
      studiedToday: [{ card_id: "c", cloze_ord: 0 }],
      retrievability: (entry) => recall.get(entry.queue_key) ?? 0,
    });
    expect(order.map((entry) => entry.queue_key)).toEqual(["b:0", "a:0"]);
  });

  it("shows one gap of a card when siblings are spaced, and none if one was studied today", () => {
    const upcoming = [item("x", 1), item("x", 2), item("y", 2)];
    const studiedToday = [{ card_id: "y", cloze_ord: 1 }];
    const keys = (spaceOutSiblings: boolean) =>
      arrangeStudyAhead(upcoming, { spaceOutSiblings, studiedToday }).map((entry) => entry.queue_key);
    expect(keys(true)).toEqual(["x:1"]);
    expect(keys(false)).toEqual(["x:1", "x:2", "y:2"]);
  });
});
