import { describe, expect, it } from "vitest";
import { buildScheduler } from "@deephaus/scheduling";

import { importedFsrs7Memory } from "../src/index.js";

const DAY = 86_400_000;
const t0 = Date.parse("2026-01-05T09:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

describe("importedFsrs7Memory", () => {
  it("replays a complete Anki history on FSRS-7", () => {
    const logs = [
      { rating: 3, state: 0, review: iso(t0) },
      { rating: 3, state: 2, review: iso(t0 + 3 * DAY) },
      { rating: 3, state: 2, review: iso(t0 + 12 * DAY) },
    ];
    const memory = importedFsrs7Memory(
      { stability: 30, difficulty: 5, state: 2, last_review: logs[2]!.review },
      logs,
    );
    expect(memory?.stability_fast).toBeGreaterThan(0);
    // Rebuilt from the grades, not copied from Anki's estimate.
    expect(memory?.stability).not.toBe(30);
  });

  it("converts a card whose history doesn't start from new, keeping its interval", () => {
    const lastReview = t0 + 40 * DAY;
    const logs = [{ rating: 3, state: 2, review: iso(lastReview) }];
    const memory = importedFsrs7Memory(
      { stability: 25, difficulty: 4, state: 2, last_review: iso(lastReview) },
      logs,
    );
    expect(memory).not.toBeNull();
    const scheduler = buildScheduler({ enableFuzz: false });
    const row = {
      due: iso(lastReview + 25 * DAY),
      stability: memory!.stability,
      stability_fast: memory!.stability_fast,
      difficulty: memory!.difficulty,
      elapsed_days: 0,
      scheduled_days: 25,
      reps: 4,
      lapses: 0,
      state: 2,
      last_review: iso(lastReview),
      learning_steps: 0,
      fsrs_version: 7,
    };
    expect(scheduler.retrievability(row, new Date(lastReview + 25 * DAY))).toBeCloseTo(0.9, 3);
  });

  it("leaves new cards to start fresh", () => {
    expect(
      importedFsrs7Memory({ stability: 0, difficulty: 0, state: 0, last_review: null }, []),
    ).toBeNull();
  });
});
