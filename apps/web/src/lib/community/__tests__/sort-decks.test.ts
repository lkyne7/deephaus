import { describe, expect, it } from "vitest";
import { buildCommunityListing, sortCommunityDecks } from "@/lib/community/sort-decks";
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

  it("orders by first publish date, newest first", () => {
    const decks = [
      deck("old", { published_at: "2025-03-01T00:00:00Z" }),
      deck("new", { published_at: "2026-10-01T00:00:00Z" }),
      deck("mid", { published_at: "2026-02-01T00:00:00Z" }),
    ];
    expect(ids(sortCommunityDecks(decks, "newest"))).toEqual(["new", "mid", "old"]);
  });

  it("leaves the input untouched", () => {
    const decks = [deck("a"), deck("b", { subscriber_count: 2 })];
    sortCommunityDecks(decks, "subscribers");
    expect(ids(decks)).toEqual(["a", "b"]);
  });
});

describe("buildCommunityListing", () => {
  const decks = [
    deck("d", { subscriber_count: 10 }),
    deck("a", { subscriber_count: 40 }),
    deck("mine", { subscriber_count: 99, is_owner: true }),
    deck("c", { subscriber_count: 20 }),
    deck("b", { subscriber_count: 30 }),
  ];
  const browse = { query: "", sort: "subscribers", featuredCount: 3 } as const;

  it("lifts the top decks into Featured and keeps the rest in the list", () => {
    const listing = buildCommunityListing(decks, browse);
    expect(ids(listing.featured)).toEqual(["a", "b", "c"]);
    expect(ids(listing.rest)).toEqual(["mine", "d"]);
    expect(ids(listing.all)).toEqual(["mine", "a", "b", "c", "d"]);
  });

  it("drops Featured when the catalog would only mirror it", () => {
    const listing = buildCommunityListing(decks.slice(0, 3), browse);
    expect(listing.featured).toEqual([]);
    expect(listing.rest).toHaveLength(3);
  });

  it("drops Featured while searching and matches on title", () => {
    const listing = buildCommunityListing(decks, { ...browse, query: " MIN " });
    expect(listing.featured).toEqual([]);
    expect(ids(listing.all)).toEqual(["mine"]);
  });

  it("drops Featured on any other sort so the list stays complete", () => {
    const listing = buildCommunityListing(decks, { ...browse, sort: "newest" });
    expect(listing.featured).toEqual([]);
    expect(listing.rest).toHaveLength(decks.length);
  });
});
