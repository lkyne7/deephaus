import { describe, expect, it } from "vitest";
import { Rating } from "ts-fsrs";
import {
  calculateReadiness,
  estimatedSecondsPerReview,
  gradeCramItem,
  reviewCapacity,
  rollingMedianResponseMs,
  sortCramQueue,
} from "@/lib/cram/scheduler";
import { cardOrdinals, normalizeSelectionSpec } from "@/lib/cram/selection";
import { localDateKey, zonedDateTimeToUtc } from "@/lib/cram/time";
import type { CramCardRow, CramPlanItemRow } from "@/lib/cram/types";

function item(overrides: Partial<CramPlanItemRow> = {}): CramPlanItemRow {
  return {
    id: "item-1",
    plan_id: "plan-1",
    card_id: "card-1",
    project_id: "project-1",
    cloze_ord: 0,
    due: "2026-07-10T12:00:00.000Z",
    stability: 0,
    difficulty: 0,
    elapsed_days: 0,
    scheduled_days: 0,
    reps: 0,
    lapses: 0,
    state: 0,
    last_review: null,
    learning_steps: 0,
    version: 0,
    created_at: "2026-07-10T12:00:00.000Z",
    updated_at: "2026-07-10T12:00:00.000Z",
    ...overrides,
  };
}

function card(overrides: Partial<CramCardRow> = {}): CramCardRow {
  return {
    id: "card-1",
    project_id: "project-1",
    source_id: "source-1",
    source_chunk_id: null,
    type: "basic",
    front: "Question",
    back: "Answer",
    cloze_text: null,
    extra: null,
    occlusion_data: null,
    tags: [],
    sort_order: 0,
    ...overrides,
  };
}

describe("Cram selection snapshots", () => {
  it("normalizes and deduplicates every selection category", () => {
    expect(
      normalizeSelectionSpec({
        deck_ids: [" deck-a ", "deck-a"],
        tags: ["biology", "", "biology"],
      }),
    ).toEqual({
      deck_ids: ["deck-a"],
      source_ids: [],
      chunk_ids: [],
      tags: ["biology"],
      card_ids: [],
    });
  });

  it("expands cloze cards into independent study ordinals", () => {
    expect(
      cardOrdinals(
        card({
          type: "cloze",
          front: null,
          cloze_text: "{{c1::Alpha}} and {{c3::Gamma}}",
        }),
      ),
    ).toEqual([1, 3]);
  });
});

describe("Cram scheduling", () => {
  it("uses a stable rolling median and converts minutes to capacity", () => {
    expect(rollingMedianResponseMs([30_000, 10_000, 20_000, 999_999_999])).toBe(25_000);
    expect(estimatedSecondsPerReview([10_000, 20_000, 30_000])).toBe(20);
    expect(reviewCapacity(15, 20)).toBe(45);
  });

  it("treats unseen items as zero deadline readiness", () => {
    expect(
      calculateReadiness(
        [item(), item({ id: "item-2", card_id: "card-2" })],
        new Date("2026-07-20T12:00:00.000Z"),
        0.9,
        new Map(),
      ),
    ).toMatchObject({
      mean_retrievability: 0,
      target_coverage: 0,
      unseen_items: 2,
      total_items: 2,
    });
  });

  it("orders private-due work before unseen work", () => {
    const now = new Date("2026-07-10T13:00:00.000Z");
    const due = item({
      id: "due",
      card_id: "due-card",
      state: 2,
      stability: 5,
      difficulty: 5,
      reps: 2,
      last_review: "2026-07-05T12:00:00.000Z",
    });
    const unseen = item({ id: "new", card_id: "new-card" });

    expect(
      sortCramQueue(
        [unseen, due],
        now,
        new Date("2026-07-20T12:00:00.000Z"),
        0.9,
        new Map(),
      ).map((row) => row.id),
    ).toEqual(["due", "new"]);
  });

  it("grades a private copy without mutating the source item", () => {
    const source = item();
    const result = gradeCramItem(
      source,
      Rating.Good,
      new Date("2026-07-10T12:01:00.000Z"),
      0.9,
    );

    expect(source.state).toBe(0);
    expect(source.reps).toBe(0);
    expect(result.next.state).not.toBe(0);
    expect(result.next.reps).toBe(1);
  });
});

describe("Cram deadlines", () => {
  it("preserves local date-only deadlines through timezone conversion", () => {
    const instant = zonedDateTimeToUtc(
      { year: 2026, month: 11, day: 1, hour: 23, minute: 59, second: 59 },
      "America/New_York",
    );
    expect(localDateKey(instant, "America/New_York")).toBe("2026-11-01");
  });
});
