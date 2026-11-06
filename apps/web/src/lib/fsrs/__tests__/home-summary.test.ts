import { describe, expect, it } from "vitest";
import {
  estimateStudyDuration,
  nextCardsLabel,
  pickContinueDecks,
  pickRecentDecks,
} from "@/lib/fsrs/home-summary";

const deck = (deck_id: string, due: number, last_reviewed: string | null = null, new_card_count = 0) => ({
  deck_id,
  due,
  new: 0,
  new_card_count,
  last_reviewed,
});

describe("estimateStudyDuration", () => {
  it("rounds to at least a minute and switches to hours", () => {
    expect(estimateStudyDuration(1)).toBe("1 minute");
    expect(estimateStudyDuration(49)).toBe("7 minutes");
    expect(estimateStudyDuration(1000)).toBe("2h 30m");
  });
});

describe("home deck lists", () => {
  it("keeps the three decks with most due", () => {
    const decks = [deck("a", 0), deck("b", 3), deck("c", 9), deck("d", 1), deck("e", 2)];
    expect(pickContinueDecks(decks).map((d) => d.deck_id)).toEqual(["c", "b", "e"]);
  });

  it("orders studied decks by most recent review and skips unstudied ones", () => {
    const decks = [
      deck("a", 0, "2026-11-01T00:00:00Z"),
      deck("b", 0),
      deck("c", 0, "2026-11-05T00:00:00Z"),
    ];
    expect(pickRecentDecks(decks).map((d) => d.deck_id)).toEqual(["c", "a"]);
  });
});

describe("nextCardsLabel", () => {
  it("points to tomorrow when new cards are held back by a daily limit", () => {
    expect(nextCardsLabel([deck("a", 0, null, 5)], {}, "2026-11-06")).toBe(
      "next cards tomorrow morning",
    );
  });

  it("uses the soonest day in the forecast", () => {
    const forecast = { "2026-11-20": 2, "2026-11-07": 0, "2026-11-09": 1 };
    expect(nextCardsLabel([], forecast, "2026-11-06")).toBe("next cards Nov 9");
    expect(nextCardsLabel([], { "2026-11-07": 3 }, "2026-11-06")).toBe("next cards tomorrow");
  });

  it("says nothing when no cards are scheduled", () => {
    expect(nextCardsLabel([], {}, "2026-11-06")).toBeNull();
  });
});
