import { describe, expect, it } from "vitest";
import {
  DEFAULT_DECK_SORT,
  cardCountLabel,
  deckStatus,
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

describe("deck status, filters and paused decks", () => {
  const mixed = [
    deck({ deck_id: "study", due: 3, new: 1, new_card_count: 4 }),
    deck({ deck_id: "done", due: 0, new: 0 }),
    deck({ deck_id: "paused", due: 9, new: 2, paused: true }),
    deck({ deck_id: "empty", total: 0 }),
    deck({ deck_id: "added", due: 1, is_community: true }),
    deck({ deck_id: "shared", due: 2, is_published: true }),
  ].map(toDeckRow);

  it("names what each deck needs today", () => {
    expect(mixed.map(deckStatus)).toEqual(["study", "caught-up", "paused", "empty", "study", "study"]);
  });

  it("sinks paused and empty decks in the default order", () => {
    expect(ids(visibleDeckRows(mixed, "", DEFAULT_DECK_SORT))).toEqual([
      "study",
      "shared",
      "added",
      "done",
      "paused",
      "empty",
    ]);
  });

  it("filters by where a deck came from and by status", () => {
    expect(ids(visibleDeckRows(mixed, "", DEFAULT_DECK_SORT, { ownership: "community" }))).toEqual(["added"]);
    expect(ids(visibleDeckRows(mixed, "", DEFAULT_DECK_SORT, { ownership: "published" }))).toEqual(["shared"]);
    expect(ids(visibleDeckRows(mixed, "", DEFAULT_DECK_SORT, { ownership: "mine" }))).not.toContain("added");
    expect(ids(visibleDeckRows(mixed, "", DEFAULT_DECK_SORT, { status: "paused" }))).toEqual(["paused"]);
    expect(ids(visibleDeckRows(mixed, "", DEFAULT_DECK_SORT, { status: "empty" }))).toEqual(["empty"]);
  });

  it("splits a deck into on track, due and not started without going negative", () => {
    // Due is counted per cloze, so it can exceed what the card total leaves.
    const row = toDeckRow(deck({ deck_id: "x", total: 10, due: 8, new_card_count: 5 }));
    expect(row.unseenCount).toBe(5);
    expect(row.onTrackCount).toBe(0);
    expect(toDeckRow(deck({ deck_id: "y", total: 10, due: 2, new_card_count: 3 })).onTrackCount).toBe(5);
  });
});
