import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { buildPerDeck, totalsFromPerDeck } from "@/lib/fsrs/dashboard-metrics";

const summary = (project_id: string, due_count: number, new_card_count: number) => ({
  project_id,
  card_count: 20,
  due_count,
  new_card_count,
  new_studied_today: 0,
  last_review: null,
});

describe("paused decks", () => {
  const projects = [
    { id: "a", name: "Active", deck_name: null, settings: { newCardsPerDay: 5 } },
    { id: "p", name: "Paused", deck_name: null, settings: { newCardsPerDay: 5, paused: true } },
  ];
  const perDeck = buildPerDeck(projects, [summary("a", 3, 8), summary("p", 7, 9)]);

  it("keep their own counts", () => {
    expect(perDeck.map((deck) => [deck.deck_id, deck.due, deck.new, deck.paused])).toEqual([
      ["a", 3, 5, false],
      ["p", 7, 5, true],
    ]);
  });

  it("are left out of the totals", () => {
    expect(totalsFromPerDeck(perDeck)).toEqual({ dueNow: 3, newTodayRemaining: 5 });
  });
});
