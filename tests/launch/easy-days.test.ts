import { describe, it, expect } from "vitest";
import {
  normalEasyDays,
  weekendWarriorDays,
  easyDaysSchema,
  parseEasyDays,
} from "../../packages/shared/src/easy-days";
import {
  buildScheduler,
  emptyCard,
  State,
  Rating,
  studyWeekday,
  cardToRowFields,
} from "../../packages/scheduling/src/index";
import { applyEasyDays } from "../../packages/scheduling/src/easy-days";

const now = new Date("2026-09-21T16:00:00Z");
function card(index = 0) {
  return {
    ...emptyCard(now),
    state: State.Review,
    stability: 10 + index / 100,
    difficulty: 5,
    reps: 10,
    due: now,
    last_review: new Date(now.getTime() - 10 * 86400000),
    scheduled_days: 10,
  };
}

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
  it("does not change the default scheduler or learning steps", () => {
    const base = buildScheduler().repeat(card(), now);
    expect(
      buildScheduler({ easyDays: normalEasyDays() }).repeat(card(), now),
    ).toEqual(base);
    for (const rating of [Rating.Again, Rating.Hard, Rating.Good] as const) {
      expect(
        buildScheduler({ easyDays: weekendWarriorDays() }).next(
          emptyCard(now),
          now,
          rating,
        ),
      ).toEqual(buildScheduler().next(emptyCard(now), now, rating));
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
      const original = buildScheduler().repeat(card(i), now);
      const scheduler = buildScheduler({
        easyDays: weekendWarriorDays(),
        timezone: "America/Toronto",
        dayStartHour: 4,
      });
      const adjusted = scheduler.repeat(card(i), now);
      expect(adjusted[Rating.Hard].card.scheduled_days).toBeLessThanOrEqual(
        adjusted[Rating.Good].card.scheduled_days,
      );
      expect(adjusted[Rating.Good].card.scheduled_days).toBeLessThanOrEqual(
        adjusted[Rating.Easy].card.scheduled_days,
      );
      for (const rating of [
        Rating.Again,
        Rating.Hard,
        Rating.Good,
        Rating.Easy,
      ] as const) {
        const old = original[rating].card,
          next = adjusted[rating].card;
        before += Number(studyWeekday(old.due, "America/Toronto") >= 5);
        after += Number(studyWeekday(next.due, "America/Toronto") >= 5);
        const delta = next.scheduled_days - old.scheduled_days;
        changed += Number(delta !== 0);
        expect(Math.abs(delta)).toBeLessThanOrEqual(
          Math.min(3, Math.max(1, Math.floor(old.scheduled_days * 0.1))),
        );
        expect(next.due.getTime() - old.due.getTime()).toBe(delta * 86400000);
        expect(next.stability).toBe(old.stability);
        expect(next.difficulty).toBe(old.difficulty);
        expect(adjusted[rating].log).toEqual(original[rating].log);
        expect(
          cardToRowFields(scheduler.next(card(i), now, rating).card),
        ).toEqual(cardToRowFields(next));
      }
    }
    expect(changed).toBeGreaterThan(30);
    expect(after).toBeLessThan(before * 0.85);
  });
  it("Minimum moves more reviews than Reduced without hiding due cards", () => {
    let reduced = 0,
      minimum = 0;
    for (let i = 0; i < 200; i++) {
      const base = buildScheduler().repeat(card(i), now);
      // A controlled Saturday date with well-separated button intervals.
      for (const [rating, interval] of [
        [2, 7],
        [3, 14],
        [4, 21],
      ] as const) {
        base[rating].card.due = new Date("2026-10-03T12:00:00Z");
        base[rating].card.scheduled_days = interval;
      }
      const copy = () =>
        Object.assign(
          {},
          ...[1, 2, 3, 4].map((r) => ({
            [r]: { ...base[r as 1], card: { ...base[r as 1].card } },
          })),
        ) as typeof base;
      reduced += Number(
        applyEasyDays(copy(), {
          easyDays: weekendWarriorDays(),
        })[3].card.due.getUTCDay() === 6,
      );
      minimum += Number(
        applyEasyDays(copy(), {
          easyDays: [
            "normal",
            "normal",
            "normal",
            "normal",
            "normal",
            "minimum",
            "minimum",
          ],
        })[3].card.due.getUTCDay() === 6,
      );
    }
    expect(minimum).toBeLessThan(reduced);
  });
});
