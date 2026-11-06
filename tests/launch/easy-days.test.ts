import { describe, it, expect } from "vitest";
import {
  normalEasyDays,
  weekendWarriorDays,
  easyDaysSchema,
  parseEasyDays,
} from "../../packages/shared/src/easy-days";
import {
  buildScheduler,
  State,
  Rating,
  studyWeekday,
  type CardReviewRow,
  type GradeResult,
} from "../../packages/scheduling/src/index";
import { applyEasyDays } from "../../packages/scheduling/src/easy-days";

const now = new Date("2026-09-21T16:00:00Z");
const DAY = 86400000;
/** A mature review card; each index is a distinct card with its own fuzz. */
function card(index = 0) {
  const review: CardReviewRow = {
    due: now.toISOString(),
    last_review: new Date(now.getTime() - 10 * DAY).toISOString(),
    state: State.Review,
    stability: 10 + index / 100,
    difficulty: 5,
    elapsed_days: 10,
    scheduled_days: 10,
    reps: 10,
    lapses: 0,
    learning_steps: 0,
  };
  return { cardKey: `card-${index}:0`, review, now };
}
const newCard = { cardKey: "new:0", review: null, now };
const grades = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as const;

describe("Easy Days", () => {
  it("defaults legacy/malformed settings to normal and validates seven weekdays", () => {
    expect(parseEasyDays(null)).toEqual(normalEasyDays());
    expect(parseEasyDays("not json")).toEqual(normalEasyDays());
    expect(parseEasyDays(JSON.stringify(weekendWarriorDays()))).toEqual(
      weekendWarriorDays(),
    );
    for (const value of [
      [],
      Array(7).fill("reduced"),
      [...normalEasyDays(), "normal"],
      ["bad", ...normalEasyDays().slice(1)],
    ]) {
      expect(easyDaysSchema.safeParse(value).success).toBe(false);
    }
  });
  it("does not change the default scheduler or same-day steps", () => {
    const base = buildScheduler().preview(card());
    expect(buildScheduler({ easyDays: normalEasyDays() }).preview(card())).toEqual(base);
    const plain = buildScheduler().preview(newCard);
    const adjusted = buildScheduler({ easyDays: weekendWarriorDays() }).preview(newCard);
    expect(plain[Rating.Again].next.state).toBe(State.Learning);
    for (const rating of grades) {
      // Only review-length intervals are ever moved.
      if (plain[rating].next.state !== State.Review) {
        expect(adjusted[rating]).toEqual(plain[rating]);
      }
    }
  });
  it("honors timezone, rollover, DST and invalid-zone fallback", () => {
    expect(
      studyWeekday(new Date("2026-09-26T05:00:00Z"), "America/Toronto", 4),
    ).toBe(4);
    expect(
      studyWeekday(new Date("2026-09-26T08:00:00Z"), "America/Toronto", 4),
    ).toBe(5);
    expect(
      studyWeekday(new Date("2026-11-01T06:30:00Z"), "America/Toronto", 4),
    ).toBe(5);
    expect(
      studyWeekday(new Date("2026-11-01T09:00:00Z"), "America/Toronto", 4),
    ).toBe(6);
    expect(studyWeekday(now, "invalid")).toBe(0);
  });
  it("reduces weekend reviews, preserves grade order and bounds every move", () => {
    let before = 0,
      after = 0,
      changed = 0;
    for (let i = 0; i < 600; i++) {
      const original = buildScheduler().preview(card(i));
      const scheduler = buildScheduler({
        easyDays: weekendWarriorDays(),
        timezone: "America/Toronto",
        dayStartHour: 4,
      });
      const adjusted = scheduler.preview(card(i));
      expect(adjusted[Rating.Hard].next.scheduled_days).toBeLessThanOrEqual(
        adjusted[Rating.Good].next.scheduled_days,
      );
      expect(adjusted[Rating.Good].next.scheduled_days).toBeLessThanOrEqual(
        adjusted[Rating.Easy].next.scheduled_days,
      );
      for (const rating of grades) {
        const old = original[rating].next,
          next = adjusted[rating].next;
        before += Number(studyWeekday(new Date(old.due), "America/Toronto") >= 5);
        after += Number(studyWeekday(new Date(next.due), "America/Toronto") >= 5);
        const delta = next.scheduled_days - old.scheduled_days;
        changed += Number(delta !== 0);
        expect(Math.abs(delta)).toBeLessThanOrEqual(
          Math.min(3, Math.max(1, Math.floor(old.scheduled_days * 0.1))),
        );
        expect(Date.parse(next.due) - Date.parse(old.due)).toBe(delta * DAY);
        expect(adjusted[rating].intervalDays - original[rating].intervalDays).toBeCloseTo(delta, 9);
        expect(next.stability).toBe(old.stability);
        expect(next.difficulty).toBe(old.difficulty);
        expect(adjusted[rating].log).toEqual(original[rating].log);
        expect(scheduler.grade({ ...card(i), rating })).toEqual(adjusted[rating]);
      }
    }
    expect(changed).toBeGreaterThan(30);
    expect(after).toBeLessThan(before * 0.85);
  });
  it("moves fractional FSRS-7 intervals by whole days", () => {
    const scheduler = buildScheduler({ enableFuzz: false, easyDays: weekendWarriorDays() });
    const plain = buildScheduler({ enableFuzz: false });
    let moved = 0;
    for (let i = 0; i < 14; i++) {
      // A new card graded Good gets a fractional review interval of several days.
      const at = new Date(now.getTime() + i * DAY);
      const input = { cardKey: `fresh-${i}:0`, review: null, now: at };
      const before = plain.preview(input)[Rating.Good];
      const after = scheduler.preview(input)[Rating.Good];
      expect(before.next.scheduled_days % 1).not.toBe(0);
      const delta = after.next.scheduled_days - before.next.scheduled_days;
      expect(Math.abs(delta - Math.round(delta))).toBeLessThan(1e-9);
      expect(Date.parse(after.next.due) - Date.parse(before.next.due)).toBe(Math.round(delta) * DAY);
      moved += Number(delta !== 0);
    }
    expect(moved).toBeGreaterThan(0);
  });
  it("Minimum moves more reviews than Reduced without hiding due cards", () => {
    let reduced = 0,
      minimum = 0;
    for (let i = 0; i < 200; i++) {
      const base = buildScheduler().preview(card(i));
      // A controlled Saturday date with well-separated button intervals.
      for (const [rating, interval] of [
        [2, 7],
        [3, 14],
        [4, 21],
      ] as const) {
        base[rating].next.due = "2026-10-03T12:00:00.000Z";
        base[rating].next.scheduled_days = interval;
      }
      const copy = (): GradeResult[] =>
        grades.map((rating) => ({ ...base[rating], next: { ...base[rating].next } }));
      const withReduced = copy();
      applyEasyDays(withReduced, { easyDays: weekendWarriorDays() });
      reduced += Number(new Date(withReduced[2]!.next.due).getUTCDay() === 6);
      const withMinimum = copy();
      applyEasyDays(withMinimum, {
        easyDays: ["normal", "normal", "normal", "normal", "normal", "minimum", "minimum"],
      });
      minimum += Number(new Date(withMinimum[2]!.next.due).getUTCDay() === 6);
    }
    expect(minimum).toBeLessThan(reduced);
  });
});
