import { describe, expect, it } from "vitest";
import { loadCardStats, scheduleLine, type CardStats } from "@/lib/cards/card-stats";
import { fakeSupabase, type Tables } from "@/lib/community/__tests__/fake-supabase";

const now = new Date(2026, 10, 10, 15, 0, 0);
const at = (dayOffset: number, hour = 9) => new Date(2026, 10, 10 + dayOffset, hour).toISOString();
const stats = (over: Partial<CardStats> = {}): CardStats => ({
  reps: 3,
  due: at(3),
  last_rating: 3,
  last_reviewed: at(-2),
  ...over,
});

describe("scheduleLine", () => {
  it("says when the card is next due, how often it was reviewed and the last grade", () => {
    expect(scheduleLine(stats(), false, now)).toBe("Next due in 3 days · 3 reviews · last graded Good");
    expect(scheduleLine(stats({ due: at(1), reps: 1, last_rating: 1 }), false, now)).toBe(
      "Next due tomorrow · 1 review · last graded Again",
    );
    expect(scheduleLine(stats({ due: at(0, 23), last_rating: 2 }), false, now)).toBe(
      "Due today · 3 reviews · last graded Hard",
    );
    expect(scheduleLine(stats({ due: at(0, 1) }), false, now)).toMatch(/^Due today/);
  });

  it("counts whole days for a card that is late", () => {
    expect(scheduleLine(stats({ due: at(-1) }), false, now)).toMatch(/^Overdue by a day/);
    expect(scheduleLine(stats({ due: at(-5), last_rating: 4 }), false, now)).toBe(
      "Overdue by 5 days · 3 reviews · last graded Easy",
    );
  });

  it("describes a card that has not been studied, or is suspended", () => {
    const fresh = stats({ reps: 0, due: null, last_rating: null, last_reviewed: null });
    expect(scheduleLine(fresh, false, now)).toBe("New · not studied yet");
    expect(scheduleLine(fresh, true, now)).toBe("Suspended · not studied yet");
    expect(scheduleLine(stats(), true, now)).toBe("Suspended · 3 reviews · last graded Good");
    expect(scheduleLine(stats({ last_rating: null }), false, now)).toBe("Next due in 3 days · 3 reviews");
  });
});

function seed(): Tables {
  return {
    projects: [{ id: "deck", user_id: "me" }],
    sources: [{ id: "src", project_id: "deck" }],
    generation_jobs: [{ id: "job", source_id: "src" }],
    cards: [
      { id: "cloze", job_id: "job" },
      { id: "fresh", job_id: "job" },
    ],
    card_reviews: [
      { id: "r1", card_id: "cloze", user_id: "me", cloze_ord: 1, reps: 2, due: "2026-11-20T00:00:00.000Z" },
      { id: "r2", card_id: "cloze", user_id: "me", cloze_ord: 2, reps: 3, due: "2026-11-12T00:00:00.000Z" },
      // A part that was only suspended has a row but no reviews.
      { id: "r3", card_id: "cloze", user_id: "me", cloze_ord: 3, reps: 0, due: "2026-11-01T00:00:00.000Z" },
      { id: "r4", card_id: "cloze", user_id: "someone-else", cloze_ord: 1, reps: 9, due: "2026-11-02T00:00:00.000Z" },
    ],
    review_logs: [
      { id: "l1", card_id: "cloze", user_id: "me", rating: 4, review: "2026-11-01T10:00:00.000Z" },
      { id: "l2", card_id: "cloze", user_id: "me", rating: 2, review: "2026-11-05T10:00:00.000Z" },
      { id: "l3", card_id: "cloze", user_id: "someone-else", rating: 1, review: "2026-11-09T10:00:00.000Z" },
    ],
  };
}

describe("loadCardStats", () => {
  it("adds up the card's parts and takes the earliest due date and the latest grade", async () => {
    expect(await loadCardStats(fakeSupabase(seed()) as never, "me", "cloze")).toEqual({
      reps: 5,
      due: "2026-11-12T00:00:00.000Z",
      last_rating: 2,
      last_reviewed: "2026-11-05T10:00:00.000Z",
    });
  });

  it("reports a card that has never been studied", async () => {
    expect(await loadCardStats(fakeSupabase(seed()) as never, "me", "fresh")).toEqual({
      reps: 0,
      due: null,
      last_rating: null,
      last_reviewed: null,
    });
  });

  it("finds nothing for someone else's card", async () => {
    expect(await loadCardStats(fakeSupabase(seed()) as never, "someone-else", "cloze")).toBeNull();
    expect(await loadCardStats(fakeSupabase(seed()) as never, "me", "missing")).toBeNull();
  });
});
