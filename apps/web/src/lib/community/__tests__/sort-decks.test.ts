import { describe, expect, it } from "vitest";
import { cardMixLabel, learnerLabel, topicLabels } from "@/lib/community/labels";
import { sortCommunityDecks, updatedLabel, visibleCommunityDecks } from "@/lib/community/sort-decks";
import type { CommunityDeckRow } from "@/lib/community/types";

function deck(id: string, overrides: Partial<CommunityDeckRow> = {}): CommunityDeckRow {
  return {
    id,
    publisher_id: "someone",
    source_project_id: `project-${id}`,
    title: id,
    description: null,
    version: 1,
    card_count: 10,
    subscriber_count: 0,
    avg_rating: 0,
    rating_count: 0,
    published_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    is_subscribed: false,
    subscription_sync_mode: null,
    local_project_id: null,
    is_owner: false,
    my_rating: null,
    ...overrides,
  };
}

const ids = (decks: CommunityDeckRow[]) => decks.map((d) => d.id);

describe("sortCommunityDecks", () => {
  it("orders by subscribers, then card count", () => {
    const decks = [
      deck("few", { subscriber_count: 1 }),
      deck("small", { subscriber_count: 5, card_count: 10 }),
      deck("large", { subscriber_count: 5, card_count: 90 }),
    ];
    expect(ids(sortCommunityDecks(decks, "subscribers"))).toEqual(["large", "small", "few"]);
  });

  it("orders by rating, breaking ties on how many people rated", () => {
    const decks = [
      deck("good", { avg_rating: 4.2, rating_count: 50 }),
      deck("best-few", { avg_rating: 4.8, rating_count: 3 }),
      deck("best-many", { avg_rating: 4.8, rating_count: 40 }),
    ];
    expect(ids(sortCommunityDecks(decks, "rating"))).toEqual(["best-many", "best-few", "good"]);
  });

  it("puts unrated decks after low-rated ones", () => {
    const decks = [
      deck("unrated", { subscriber_count: 900 }),
      deck("poor", { avg_rating: 1, rating_count: 1 }),
    ];
    expect(ids(sortCommunityDecks(decks, "rating"))).toEqual(["poor", "unrated"]);
  });

  it("orders by when the cards last changed, newest first", () => {
    const decks = [
      deck("old", { published_at: "2025-03-01T00:00:00Z" }),
      deck("new", { published_at: "2026-10-01T00:00:00Z" }),
      // Published long ago, but republished last.
      deck("revised", { published_at: "2024-01-01T00:00:00Z", content_updated_at: "2026-11-01T00:00:00Z" }),
    ];
    expect(ids(sortCommunityDecks(decks, "newest"))).toEqual(["revised", "new", "old"]);
  });

  it("leaves the input untouched", () => {
    const decks = [deck("a"), deck("b", { subscriber_count: 2 })];
    sortCommunityDecks(decks, "subscribers");
    expect(ids(decks)).toEqual(["a", "b"]);
  });
});

describe("visibleCommunityDecks", () => {
  const decks = [
    deck("anatomy", { subscriber_count: 10, subject: "medicine", author: "maya" }),
    deck("pharma", { subscriber_count: 40, subject: "medicine", description: "Drug classes" }),
    deck("kanji", { subscriber_count: 99, subject: "languages" }),
    deck("misc", { subscriber_count: 20 }),
  ];
  const browse = { query: "", sort: "subscribers" } as const;

  it("lists every deck in order, with no deck held back", () => {
    expect(ids(visibleCommunityDecks(decks, browse))).toEqual(["kanji", "pharma", "misc", "anatomy"]);
  });

  it("narrows to a subject", () => {
    expect(ids(visibleCommunityDecks(decks, { ...browse, subject: "medicine" }))).toEqual([
      "pharma",
      "anatomy",
    ]);
  });

  it("searches the title, the description and the author", () => {
    expect(ids(visibleCommunityDecks(decks, { ...browse, query: " KAN " }))).toEqual(["kanji"]);
    expect(ids(visibleCommunityDecks(decks, { ...browse, query: "drug" }))).toEqual(["pharma"]);
    expect(ids(visibleCommunityDecks(decks, { ...browse, query: "maya" }))).toEqual(["anatomy"]);
  });

  it("applies the search inside the subject", () => {
    expect(ids(visibleCommunityDecks(decks, { ...browse, query: "kanji", subject: "medicine" }))).toEqual([]);
  });
});

describe("labels", () => {
  const now = new Date("2026-11-10T12:00:00Z");

  it("says how long ago the cards changed", () => {
    expect(updatedLabel("2026-11-10T08:00:00Z", now)).toBe("Updated today");
    expect(updatedLabel("2026-11-09T08:00:00Z", now)).toBe("Updated yesterday");
    expect(updatedLabel("2026-11-05T12:00:00Z", now)).toBe("Updated 5 days ago");
    expect(updatedLabel("2026-08-03T12:00:00Z", now)).toBe("Updated Aug 3");
    expect(updatedLabel("2025-08-03T12:00:00Z", now)).toBe("Updated Aug 3, 2025");
  });

  it("counts learners and card types", () => {
    expect(learnerLabel(1)).toBe("1 learner");
    expect(learnerLabel(1820)).toBe("1,820 learners");
    expect(cardMixLabel({ cloze: 112, basic: 300, "image-occlusion": 0 })).toBe(
      "300 front and back · 112 cloze",
    );
    expect(cardMixLabel({})).toBe("");
  });

  it("turns tags into topics: last part of a nested tag, no page markers, no repeats", () => {
    expect(
      topicLabels([
        "PDF::Page1",
        "Gastrointestinal::Pancreatitis",
        "Gastrointestinal::Cholangitis",
        "pancreatitis",
        "Notes Chunk1",
        "Biology",
        "Page 12",
      ]),
    ).toEqual(["Pancreatitis", "Cholangitis", "Biology"]);
    expect(topicLabels(["a", "b", "c"], 2)).toEqual(["a", "b"]);
    expect(topicLabels([])).toEqual([]);
  });
});
