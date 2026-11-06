import { describe, expect, it } from "vitest";
import {
  DEFAULT_DECK_SORT,
  cardCountLabel,
  nextDeckSort,
  reviewedLabel,
  toDeckRow,
  visibleDeckRows,
  type DeckListInput,
} from "@/lib/decks/deck-list";

function deck(over: Partial<DeckListInput> & { deck_id: string }): DeckListInput {
  return {
    name: over.deck_id,
    due: 0,
    new: 0,
    last_reviewed: null,
    total: 10,
    new_card_count: 0,
    ...over,
  };
}

const rows = [
  deck({ deck_id: "a", name: "Anatomy", due: 1, new: 1, new_card_count: 5, last_reviewed: "2026-11-01T00:00:00Z" }),
  deck({ deck_id: "b", name: "biology", due: 10, new: 0, new_card_count: 0, last_reviewed: null }),
  deck({ deck_id: "c", name: "Chemistry", due: 0, new: 7, new_card_count: 9, last_reviewed: "2026-11-05T00:00:00Z" }),
].map(toDeckRow);

const ids = (sorted: typeof rows) => sorted.map((row) => row.id);

describe("visibleDeckRows", () => {
  it("defaults to due plus new, highest first", () => {
    expect(ids(visibleDeckRows(rows, "", DEFAULT_DECK_SORT))).toEqual(["b", "c", "a"]);
  });

  it("sorts by every key", () => {
    expect(ids(visibleDeckRows(rows, "", { key: "name", dir: "asc" }))).toEqual(["a", "b", "c"]);
    expect(ids(visibleDeckRows(rows, "", { key: "progress", dir: "desc" }))).toEqual(["b", "a", "c"]);
    expect(ids(visibleDeckRows(rows, "", { key: "new", dir: "desc" }))).toEqual(["c", "a", "b"]);
    expect(ids(visibleDeckRows(rows, "", { key: "due", dir: "desc" }))).toEqual(["b", "a", "c"]);
    expect(ids(visibleDeckRows(rows, "", { key: "lastReviewed", dir: "desc" }))).toEqual(["c", "a", "b"]);
  });

  it("filters case-insensitively and leaves the input alone", () => {
    const input = [...rows];
    expect(ids(visibleDeckRows(input, "  BIO ", DEFAULT_DECK_SORT))).toEqual(["b"]);
    expect(ids(input)).toEqual(["a", "b", "c"]);
  });
});

describe("nextDeckSort", () => {
  it("uses the key's own direction, then flips on repeat", () => {
    const name = nextDeckSort(DEFAULT_DECK_SORT, "name");
    expect(name).toEqual({ key: "name", dir: "asc" });
    expect(nextDeckSort(name, "name")).toEqual({ key: "name", dir: "desc" });
    expect(nextDeckSort(name, "due")).toEqual({ key: "due", dir: "desc" });
  });
});

describe("toDeckRow", () => {
  it("treats an empty deck as no progress", () => {
    expect(toDeckRow(deck({ deck_id: "x", total: 0 })).progress).toBe(0);
    expect(toDeckRow(deck({ deck_id: "x", total: 10, new_card_count: 4 })).progress).toBe(0.6);
  });
});

describe("labels", () => {
  const now = new Date("2026-11-06T12:00:00Z");

  it("reads like the deck list", () => {
    expect(reviewedLabel(null, now)).toBe("Not reviewed yet");
    expect(reviewedLabel("2026-10-21T12:00:00Z", now)).toBe("Reviewed Oct 21");
    expect(reviewedLabel("2025-10-21T12:00:00Z", now)).toBe("Reviewed Oct 21, 2025");
    expect(cardCountLabel(1)).toBe("1 card");
    expect(cardCountLabel(1200)).toBe("1,200 cards");
  });
});
