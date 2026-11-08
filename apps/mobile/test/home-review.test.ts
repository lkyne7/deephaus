import type { DashboardStats } from "@deephaus/api-client";
import { describe, expect, it } from "vitest";
import {
  estimateMinutes,
  MAX_DECK_SEGMENTS,
  reviewBreakdown,
  welcomeLine,
} from "../lib/home-review";

function stats(overrides: Partial<DashboardStats> = {}): DashboardStats {
  return {
    reviewed_today: 0,
    cards_learned_today: 0,
    retention_pct: 0.89,
    streak: 12,
    due_now: 20,
    new_today_remaining: 39,
    total_cards: 300,
    state_breakdown: { new: 39, learning: 0, review: 261, relearning: 0 },
    per_deck: [
      { deck_id: "psy", name: "Intro to Psychology", due: 4, new: 0, last_reviewed: null, total: 50 },
      { deck_id: "bio", name: "Biology 101", due: 11, new: 39, last_reviewed: null, total: 95 },
      { deck_id: "done", name: "Finished", due: 0, new: 0, last_reviewed: null, total: 10 },
      { deck_id: "ch1", name: "Chapter 1", due: 5, new: 0, last_reviewed: null, total: 57 },
    ],
    last_optimized_at: null,
    fsrs_log_count: 0,
    ...overrides,
  };
}

describe("reviewBreakdown", () => {
  it("adds up what's ready and drops decks with nothing to study", () => {
    const result = reviewBreakdown(stats());
    expect(result.ready).toBe(59);
    expect(result.decks.map((deck) => deck.id)).toEqual(["bio", "ch1", "psy"]);
  });

  it("splits the due part of the bar by deck, between done and new", () => {
    const result = reviewBreakdown(stats({ reviewed_today: 7 }));
    expect(result.segments.map((segment) => segment.key)).toEqual([
      "done",
      "due-bio",
      "due-ch1",
      "due-psy",
      "new",
    ]);
  });

  it("merges decks past the limit into one slice", () => {
    const per_deck = Array.from({ length: MAX_DECK_SEGMENTS + 2 }, (_, index) => ({
      deck_id: `d${index}`,
      name: `Deck ${index}`,
      due: 10 - index,
      new: 0,
      last_reviewed: null,
      total: 20,
    }));
    const result = reviewBreakdown(stats({ per_deck, new_today_remaining: 0 }));
    const due = result.segments.filter((segment) => segment.kind === "due");
    expect(due).toHaveLength(MAX_DECK_SEGMENTS + 1);
    expect(due.at(-1)).toMatchObject({ key: "due-rest", deckId: null, value: 5 + 4 });
  });

  it("has no slices when nothing is ready", () => {
    const result = reviewBreakdown(
      stats({ due_now: 0, new_today_remaining: 0, per_deck: [] }),
    );
    expect(result.ready).toBe(0);
    expect(result.segments).toEqual([]);
  });
});

describe("estimateMinutes", () => {
  it("rounds to whole minutes, at least one", () => {
    expect(estimateMinutes(1)).toBe("1 min");
    expect(estimateMinutes(59)).toBe("9 min");
  });

  it("switches to hours for long sessions", () => {
    expect(estimateMinutes(400)).toBe("1 hr");
    expect(estimateMinutes(450)).toBe("1 hr 8 min");
  });
});

describe("welcomeLine", () => {
  it("greets by time of day and name", () => {
    expect(welcomeLine(8, "Sam", false)).toBe("Good morning, Sam");
    expect(welcomeLine(14, "Sam", false)).toBe("Good afternoon, Sam");
    expect(welcomeLine(21, "Sam", false)).toBe("Good evening, Sam");
    expect(welcomeLine(2, "", false)).toBe("Good evening");
  });

  it("congratulates once everything is done", () => {
    expect(welcomeLine(21, "Sam", true)).toBe("Nice work, Sam");
  });
});
