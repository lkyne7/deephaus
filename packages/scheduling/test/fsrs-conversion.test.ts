import { describe, expect, it } from "vitest";

import {
  buildScheduler,
  convertToFsrs7Memory,
  type CardReviewRow,
} from "../src/fsrs";
import { memoryEngine, memoryFromReview } from "../src/memory";

const DAY = 86_400_000;
const NOW = new Date("2026-11-12T12:00:00.000Z");

/** An FSRS-6 row as an Anki import without its history leaves it. */
function fsrs6Row(stability: number, difficulty: number, state = 2): CardReviewRow {
  return {
    due: new Date(NOW.getTime() + stability * DAY).toISOString(),
    stability,
    difficulty,
    elapsed_days: 0,
    scheduled_days: Math.round(stability),
    reps: 6,
    lapses: 1,
    state,
    last_review: NOW.toISOString(),
    learning_steps: 0,
    stability_fast: null,
    fsrs_version: 6,
  };
}

describe("FSRS-6 to FSRS-7 conversion", () => {
  const scheduler = buildScheduler({ enableFuzz: false });

  it.each([
    [0.5, 6],
    [3, 5],
    [25, 3],
    [180, 7],
    [2000, 2],
  ])("keeps recall at 90%% on the day FSRS-6 put it (stability %s, difficulty %s)", (s, d) => {
    const row = fsrs6Row(s, d);
    const atStability = new Date(NOW.getTime() + s * DAY);
    expect(scheduler.retrievability(row, atStability)).toBeCloseTo(0.9, 3);
  });

  it("keeps difficulty and gives both traces a positive stability", () => {
    for (const state of [1, 2, 3]) {
      const memory = convertToFsrs7Memory({ stability: 12, difficulty: 6.5, state });
      expect(memory).not.toBeNull();
      expect(memory!.difficulty).toBe(6.5);
      expect(memory!.stability).toBeGreaterThan(0);
      expect(memory!.stabilityFast).toBeGreaterThan(0);
    }
  });

  it("returns null for memory with nothing to convert", () => {
    expect(convertToFsrs7Memory({ stability: 0, difficulty: 5, state: 2 })).toBeNull();
  });

  it("grades a card without history on FSRS-7", () => {
    const row = fsrs6Row(20, 5);
    const at = new Date(NOW.getTime() + 20 * DAY);
    const good = scheduler.grade({ cardKey: "c:0", review: row, now: at, rating: 3 });
    expect(good.model).toBe(7);
    expect(good.next.fsrs_version).toBe(7);
    expect(good.next.stability_fast).toBeGreaterThan(0);
    // Remembered on time, so the next interval grows past the last one.
    expect(good.intervalDays).toBeGreaterThan(20);
    const again = scheduler.grade({ cardKey: "c:0", review: row, now: at, rating: 1 });
    expect(again.intervalDays).toBeLessThan(1);
  });

  it("previews the next interval for an unchanged FSRS-6 card as FSRS-7 grades it", () => {
    const row = fsrs6Row(20, 5);
    const at = new Date(NOW.getTime() + 20 * DAY);
    const preview = scheduler.preview({ cardKey: "c:0", review: row, now: at });
    expect(preview[3].model).toBe(7);
    expect(preview[3].next.due).toBe(
      scheduler.grade({ cardKey: "c:0", review: row, now: at, rating: 3 }).next.due,
    );
  });

  it("plans an FSRS-6 card the way grading will treat it", () => {
    const engine = memoryEngine();
    const row = fsrs6Row(8, 4);
    const at = new Date(NOW.getTime() + 5 * DAY);
    const memory = memoryFromReview(row);
    expect(engine.recall(memory, at.getTime())).toBeCloseTo(scheduler.retrievability(row, at), 8);
    const graded = scheduler.grade({ cardKey: "c:0", review: row, now: at, rating: 3 }).next;
    const planned = engine.review(memory, at.getTime(), 3);
    expect(planned.model).toBe(7);
    expect(planned.stability).toBeCloseTo(graded.stability, 6);
    expect(planned.stabilityFast).toBeCloseTo(graded.stability_fast as number, 6);
  });
});
