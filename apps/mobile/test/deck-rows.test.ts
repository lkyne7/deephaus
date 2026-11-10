import type { DashboardStats, StudyDeckOption } from "@deephaus/api-client";
import { describe, expect, it } from "vitest";
import {
  deckMetaLine,
  reviewedLabel,
  seenLabel,
  toDeckRows,
  visibleDeckRows,
} from "../lib/deck-rows";

const now = new Date("2026-11-10T12:00:00Z");

const decks: StudyDeckOption[] = [
  { id: "photo", title: "Photosynthesis", due: 10, new: 0, waiting: 7 },
  { id: "cardio", title: "Cardiology", due: 4, new: 5, waiting: 0, is_community: true },
  { id: "spanish", title: "Spanish verbs", due: 0, new: 0, waiting: 310 },
  { id: "blank", title: "Blank", due: 0, new: 0, waiting: 0 },
  { id: "resting", title: "Anatomy", due: 30, new: 2, waiting: 0, paused: true },
];

const stats = {
  per_deck: [
    { deck_id: "photo", name: "Photosynthesis", due: 10, new: 0, last_reviewed: "2026-11-03T12:00:00Z", total: 17, new_card_count: 0 },
    { deck_id: "cardio", name: "Cardiology", due: 4, new: 5, last_reviewed: "2026-11-10T10:00:00Z", total: 412, new_card_count: 288 },
    { deck_id: "spanish", name: "Spanish verbs", due: 0, new: 0, last_reviewed: "2026-11-10T11:30:00Z", total: 310, new_card_count: 96, is_published: true },
    { deck_id: "blank", name: "Blank", due: 0, new: 0, last_reviewed: null, total: 0, new_card_count: 0 },
    { deck_id: "resting", name: "Anatomy", due: 30, new: 2, last_reviewed: null, total: 90, new_card_count: 90, paused: true },
  ],
} as unknown as DashboardStats;

const rows = toDeckRows(decks, stats);
const row = (id: string) => rows.find((item) => item.id === id)!;
const ids = (list: typeof rows) => list.map((item) => item.id);

describe("toDeckRows", () => {
  it("joins the deck list with each deck's size, progress and origin", () => {
    expect(row("cardio")).toMatchObject({ total: 412, isCommunity: true, status: "study" });
    expect(row("cardio").seenShare).toBeCloseTo(124 / 412);
    expect(row("spanish")).toMatchObject({ isPublished: true, status: "caught-up" });
    expect(row("blank")).toMatchObject({ total: 0, status: "empty", seenShare: null });
    expect(row("resting")).toMatchObject({ paused: true, status: "paused" });
  });

  it("still lists decks before the stats arrive", () => {
    const early = toDeckRows(decks, null);
    expect(early.find((item) => item.id === "photo")).toMatchObject({ total: 17, seenShare: null });
    expect(early.find((item) => item.id === "resting")?.status).toBe("paused");
  });
});

describe("labels", () => {
  it("describes a deck by its size and where it came from or when it was studied", () => {
    expect(deckMetaLine(row("photo"), now)).toBe("17 cards · Reviewed 7d ago");
    expect(deckMetaLine(row("cardio"), now)).toBe("412 cards · From Community");
    expect(deckMetaLine(row("spanish"), now)).toBe("310 cards · Published");
    expect(deckMetaLine(row("resting"), now)).toBe("90 cards · Not reviewed yet");
    expect(deckMetaLine(row("blank"), now)).toBe("No cards yet");
  });

  it("says how long ago a deck was reviewed", () => {
    expect(reviewedLabel("2026-11-10T11:59:40Z", now)).toBe("Reviewed just now");
    expect(reviewedLabel("2026-11-10T11:30:00Z", now)).toBe("Reviewed 30m ago");
    expect(reviewedLabel("2026-11-10T10:00:00Z", now)).toBe("Reviewed 2h ago");
    expect(reviewedLabel("2026-08-03T12:00:00Z", now)).toBe("Reviewed Aug 3");
    expect(reviewedLabel(null, now)).toBe("Not reviewed yet");
  });

  it("puts the share of cards seen into words", () => {
    expect(seenLabel(row("photo"))).toBe("All cards seen");
    expect(seenLabel(row("cardio"))).toBe("30% of cards seen");
    expect(seenLabel(row("resting"))).toBe("No cards seen yet");
    expect(seenLabel(row("blank"))).toBeNull();
  });
});

describe("visibleDeckRows", () => {
  const all = { query: "", filter: "all", sort: "due" } as const;

  it("puts today's work first, then caught-up, empty and paused decks", () => {
    expect(ids(visibleDeckRows(rows, all))).toEqual(["photo", "cardio", "spanish", "blank", "resting"]);
  });

  it("filters to decks with something to study, or to paused decks", () => {
    expect(ids(visibleDeckRows(rows, { ...all, filter: "study" }))).toEqual(["photo", "cardio"]);
    expect(ids(visibleDeckRows(rows, { ...all, filter: "paused" }))).toEqual(["resting"]);
  });

  it("sorts by name or by most recent review, and searches titles", () => {
    expect(ids(visibleDeckRows(rows, { ...all, sort: "name" }))).toEqual([
      "resting",
      "blank",
      "cardio",
      "photo",
      "spanish",
    ]);
    expect(ids(visibleDeckRows(rows, { ...all, sort: "recent" })).slice(0, 3)).toEqual([
      "spanish",
      "cardio",
      "photo",
    ]);
    expect(ids(visibleDeckRows(rows, { ...all, query: " SPAN " }))).toEqual(["spanish"]);
  });
});
