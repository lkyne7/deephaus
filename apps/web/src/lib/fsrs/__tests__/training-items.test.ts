import { describe, expect, it } from "vitest";
import {
  buildFsrs7TrainingCsv,
  buildTrainingItems,
  countUsableTrainingItems,
  type TrainingLogRow,
} from "@/lib/fsrs/training-items";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 5, 15);
const at = (days: number) => new Date(T0 + days * DAY).toISOString();
const log = (
  card: string,
  days: number,
  rating: number,
  state: number | null,
  clozeOrd: number | null = 0,
): TrainingLogRow => ({ card_id: card, cloze_ord: clozeOrd, rating, state, review: at(days) });

const csvLines = (rows: TrainingLogRow[]) =>
  new TextDecoder().decode(buildFsrs7TrainingCsv(rows)).split("\n");

describe("FSRS-7 training set", () => {
  it("counts every repeat review of a card followed since it was new, same-day ones included", () => {
    const rows = [
      log("a", 0, 1, 0),
      log("a", 1 / 1440, 3, 1),
      log("a", 10 / 1440, 3, 1),
      log("a", 3, 3, 2),
    ];
    expect(countUsableTrainingItems(rows)).toBe(3);
    // FSRS-6 works in whole days: only the review after a real day gap counts.
    expect(buildTrainingItems(rows)).toHaveLength(1);
  });

  it("leaves out cards whose history does not start from new", () => {
    const rows = [log("imported", 0, 3, 2), log("imported", 5, 3, 2), log("imported", 14, 4, 2)];
    expect(countUsableTrainingItems(rows)).toBe(0);
    expect(csvLines(rows)).toEqual([
      "review_time,card_id,review_rating,review_duration,review_state",
    ]);
  });

  it("starts from the last time the card was new", () => {
    const rows = [
      log("reset", 0, 3, 0),
      log("reset", 2, 3, 2),
      log("reset", 9, 1, 0),
      log("reset", 10, 3, 1),
      log("reset", 14, 3, 2),
    ];
    expect(countUsableTrainingItems(rows)).toBe(2);
    expect(csvLines(rows).slice(1)).toEqual([
      `${T0 + 9 * DAY},reset:0,1,0,0`,
      `${T0 + 10 * DAY},reset:0,3,0,1`,
      `${T0 + 14 * DAY},reset:0,3,0,2`,
    ]);
  });

  it("writes the answer time where one was recorded", () => {
    const rows = [
      { ...log("timed", 0, 3, 0), response_ms: 4200 },
      { ...log("timed", 1, 3, 1), response_ms: null },
      log("timed", 3, 4, 2),
    ];
    expect(csvLines(rows).slice(1)).toEqual([
      `${T0},timed:0,3,4200,0`,
      `${T0 + DAY},timed:0,3,0,1`,
      `${T0 + 3 * DAY},timed:0,4,0,2`,
    ]);
  });

  it("keeps ordinals apart, ignores ungraded rows and orders the file by time", () => {
    const rows = [
      log("c", 4, 3, 2, 2),
      log("c", 0, 3, 0, 1),
      log("c", 1, 0, 2, 1),
      log("c", 0.5, 3, 0, 2),
      log("c", 2, 4, 2, 1),
      log("c", 3, 3, 0, null),
      { card_id: "c", cloze_ord: 1, rating: 3, state: 2, review: "not a date" },
    ];
    // c:1 → new, then one graded repeat; c:2 → new, then one repeat; c:0 → a single review.
    expect(countUsableTrainingItems(rows)).toBe(2);
    expect(csvLines(rows).slice(1)).toEqual([
      `${T0},c:1,3,0,0`,
      `${T0 + 0.5 * DAY},c:2,3,0,0`,
      `${T0 + 2 * DAY},c:1,4,0,2`,
      `${T0 + 4 * DAY},c:2,3,0,2`,
    ]);
  });

  it("treats rows selected without a state as unusable rather than new", () => {
    const rows = [log("x", 0, 3, null), log("x", 3, 3, null)];
    expect(countUsableTrainingItems(rows)).toBe(0);
  });
});
