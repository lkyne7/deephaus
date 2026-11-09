import { writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildScheduler, type CardReviewRow, type FsrsGrade } from "../src/fsrs";
import { memoryEngine, memoryFromReview, type Memory } from "../src/memory";
import {
  examQueue,
  examSnapshot,
  nextTouchpoint,
  planExam,
  type ExamContext,
  type ExamSpec,
  type ExamUnit,
} from "../src/exam";
import { NOW, buildDeck, reviewRow } from "./support/bakeoff";

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
const now = NOW.getTime();
const engine = memoryEngine();

const context: ExamContext = { now: NOW, timezone: "UTC", dayStartHour: 4 };
const inDays = (days: number): ExamSpec => ({
  examAt: new Date(now + days * DAY),
  targetRecall: 0.9,
  dailyMinutesCap: null,
});

/** A memory built from first rating plus later Good reviews, ending `agoMs` before now. */
function memory(first: FsrsGrade, laterGoodsDaysApart: number[], agoMs: number): Memory {
  const span = laterGoodsDaysApart.reduce((sum, gap) => sum + gap, 0) * DAY;
  let at = now - agoMs - span;
  let current = engine.review(null, at, first);
  for (const gap of laterGoodsDaysApart) {
    at += gap * DAY;
    current = engine.review(current, at, 3);
  }
  return current;
}

function unit(
  id: string,
  review: CardReviewRow | null,
  extra: Partial<ExamUnit> = {},
): ExamUnit {
  return { key: `${id}:0`, cardId: id, projectId: "deck", review, todayRatings: [], ...extra };
}

/** Recalled easily several times over two months: safe for any near exam. */
const strong = () => reviewRow(memory(4, [5, 20, 40], 2 * DAY));
/** Met once two days ago and found hard: below target at the exam, still fairly fresh. */
const weak = () => reviewRow(memory(2, [], 2 * DAY));
/** Failed on first sight two days ago and not seen since. */
const faded = () => reviewRow(memory(1, [], 2 * DAY));
/** Met once two hours ago and rated Good. */
const fresh = () => reviewRow(memory(3, [], 2 * HOUR));

describe("memory engine", () => {
  it("agrees with the grading scheduler on FSRS-7 recall and updates", () => {
    const scheduler = buildScheduler({ enableFuzz: false });
    const row = weak();
    const at = new Date(now + 7.5 * HOUR);
    expect(engine.recall(memoryFromReview(row), at.getTime())).toBeCloseTo(
      scheduler.retrievability(row, at),
      10,
    );
    for (const rating of [1, 2, 3, 4] as const) {
      const graded = scheduler.grade({ cardKey: "a:0", review: row, now: at, rating }).next;
      const next = engine.review(memoryFromReview(row), at.getTime(), rating);
      expect(next.stability).toBeCloseTo(graded.stability, 6);
      expect(next.stabilityFast).toBeCloseTo(graded.stability_fast as number, 6);
      expect(next.difficulty).toBeCloseTo(graded.difficulty, 6);
    }
  });

  it("starts a new card where grading does", () => {
    const scheduler = buildScheduler({ enableFuzz: false });
    const graded = scheduler.grade({ cardKey: "a:0", review: null, now: NOW, rating: 3 }).next;
    const next = engine.review(null, now, 3);
    expect(next.model).toBe(7);
    expect(next.stability).toBeCloseTo(graded.stability, 6);
    expect(next.stabilityFast).toBeCloseTo(graded.stability_fast as number, 6);
  });

  it("reads an FSRS-6 card's recall by the hour, where grading sees whole days", () => {
    const row: CardReviewRow = {
      ...weak(),
      stability: 2,
      stability_fast: null,
      fsrs_version: 6,
      last_review: new Date(now).toISOString(),
    };
    const fsrs6 = memoryFromReview(row);
    expect(fsrs6?.model).toBe(6);
    const afterAnHour = engine.recall(fsrs6, now + HOUR);
    const afterTwentyHours = engine.recall(fsrs6, now + 20 * HOUR);
    expect(afterAnHour).toBeGreaterThan(afterTwentyHours);
    expect(afterTwentyHours).toBeGreaterThan(engine.recall(fsrs6, now + 3 * DAY));
  });

  it("treats a card with no usable memory as unseen", () => {
    expect(memoryFromReview(null)).toBeNull();
    expect(memoryFromReview({ ...weak(), state: 0 })).toBeNull();
    expect(engine.recall(null, now)).toBe(0);
  });
});

describe("examQueue", () => {
  it("leaves alone cards already safe for the exam", () => {
    const queue = examQueue([unit("strong", strong())], inDays(7), context);
    expect(queue.items).toEqual([]);
  });

  it("strengthens a faded card and says why", () => {
    const queue = examQueue([unit("faded", faded())], inDays(7), context);
    expect(queue.items.map((item) => item.reason)).toEqual(["strengthen"]);
    expect(queue.items[0]!.recallAtExam).toBeLessThan(0.9);
    expect(queue.items[0]!.gain).toBeGreaterThan(0);
  });

  it("waits while a card that needs work is still well remembered", () => {
    // Below target a week out, but recalled far above the gate right now.
    for (const row of [fresh(), weak()]) {
      expect(engine.recall(memoryFromReview(row), now + 7 * DAY)).toBeLessThan(0.9);
      expect(examQueue([unit("card", row)], inDays(7), context).items).toEqual([]);
    }
  });

  it("pulls a card forward at most once per study day before lock-in", () => {
    const today = unit("faded", faded(), { todayRatings: [3] });
    expect(examQueue([today], inDays(7), context).items).toEqual([]);
    // With no grades supplied, a review dated today still counts.
    const failedAnHourAgo = reviewRow(memory(1, [], HOUR));
    expect(engine.recall(memoryFromReview(failedAnHourAgo), now)).toBeLessThan(0.7);
    const unknown = { ...unit("faded", failedAnHourAgo), todayRatings: undefined };
    expect(examQueue([unknown], inDays(7), context).items).toEqual([]);
  });

  it("in lock-in brings a card back only after a gap that scales with the time left", () => {
    const exam: ExamSpec = { ...inDays(0), examAt: new Date(now + 10 * HOUR) };
    // Rated Again a moment ago, then recalled: still far below target.
    const justSeen = engine.review(engine.review(null, now - 3 * MINUTE, 1), now - 2 * MINUTE, 3);
    expect(engine.recall(justSeen, exam.examAt.getTime())).toBeLessThan(0.9);
    const soon = examQueue(
      [unit("a", reviewRow(justSeen), { todayRatings: [1, 3] })],
      exam,
      context,
    );
    expect(soon.items).toEqual([]);
    // 30% of the ten hours left is about 2.3 hours after the last review.
    const readyInHours = ((soon.nextReadyAt?.getTime() ?? 0) - now) / HOUR;
    expect(readyInHours).toBeGreaterThan(2);
    expect(readyInHours).toBeLessThan(2.6);

    const later = examQueue(
      [unit("a", reviewRow(justSeen), { todayRatings: [1, 3] })],
      exam,
      { ...context, now: new Date(now + 3 * HOUR) },
    );
    expect(later.items.map((item) => item.reason)).toEqual(["lock-in"]);
  });

  it("serves a due learning step", () => {
    const lapsed = reviewRow(memory(1, [], 15 * MINUTE), {
      state: 1,
      due: new Date(now - 5 * MINUTE).toISOString(),
    });
    const queue = examQueue([unit("lapsed", lapsed, { todayRatings: [1] })], inDays(7), context);
    expect(queue.items.map((item) => item.reason)).toEqual(["learning"]);
  });

  it("spreads new cards over the early days and keeps the last ones for relearning", () => {
    // Monday 14:00 to the following Monday 14:00 is eight study days; three are held back.
    const units = buildDeck({ unseen: 100, studied: 0 }, 1);
    const queue = examQueue(units, inDays(7), context);
    expect(queue.newAllowance).toBe(20);
    expect(queue.items).toHaveLength(20);
    expect(queue.items.every((item) => item.reason === "new")).toBe(true);
  });

  it("stops pacing once the exam is inside the days held back", () => {
    // Three study days left: today, tomorrow and the exam morning.
    const exam: ExamSpec = { ...inDays(0), examAt: new Date("2026-11-11T09:00:00.000Z") };
    const queue = examQueue(buildDeck({ unseen: 100, studied: 0 }, 1), exam, context);
    expect(queue.newAllowance).toBe(100);
  });

  it("counts cards met earlier today against the day's share of new cards", () => {
    const metToday = Array.from({ length: 15 }, (_, index) =>
      unit(`met${index}`, reviewRow(memory(3, [], HOUR), { reps: 1 }), { todayRatings: [3] }),
    );
    const units = [...metToday, ...buildDeck({ unseen: 85, studied: 0 }, 1)];
    expect(examQueue(units, inDays(7), context).newAllowance).toBe(5);
  });

  it("offers every unseen card once the exam is within lock-in", () => {
    const units = buildDeck({ unseen: 40, studied: 0 }, 1);
    const exam: ExamSpec = { ...inDays(0), examAt: new Date(now + 6 * HOUR) };
    expect(examQueue(units, exam, context).items).toHaveLength(40);
  });

  it("puts light days on a lighter share of the new cards", () => {
    const units = buildDeck({ unseen: 100, studied: 0 }, 1);
    // NOW is a Monday; make Monday a minimum day.
    const easyDays = ["minimum", "normal", "normal", "normal", "normal", "normal", "normal"];
    const queue = examQueue(units, inDays(7), { ...context, easyDays: easyDays as never });
    expect(queue.newAllowance).toBeLessThan(5);
  });

  it("cuts what pays least when the day's time is spent", () => {
    const exam: ExamSpec = { ...inDays(0), examAt: new Date(now + 6 * HOUR), dailyMinutesCap: 1 };
    // Three reviews fit in a minute at 20 s each.
    const units = [
      unit("weak1", weak()),
      ...buildDeck({ unseen: 5, studied: 0 }, 1),
    ];
    const queue = examQueue(units, exam, context);
    expect(queue.items).toHaveLength(3);
    expect(queue.skipped).toBe(3);
    // Meeting an unseen card is worth far more than topping up a known one.
    expect(queue.items.every((item) => item.reason === "new")).toBe(true);
  });

  it("counts reviews already done today against the cap", () => {
    const exam: ExamSpec = { ...inDays(7), dailyMinutesCap: 1 };
    const units = [
      unit("done1", fresh(), { todayRatings: [3, 3] }),
      unit("faded1", faded()),
      unit("faded2", faded()),
    ];
    expect(examQueue(units, exam, context).items).toHaveLength(1);
  });

  it("keeps siblings of one note apart when another card can sit between them", () => {
    const units = [
      { ...unit("note", faded()), key: "note:0" },
      { ...unit("note", faded()), key: "note:1" },
      unit("other", faded()),
    ];
    const order = examQueue(units, inDays(7), context).items.map((item) => item.cardId);
    expect(order).toEqual(["note", "other", "note"]);
  });

  it("takes turns between decks for new cards", () => {
    const units = [
      unit("a1", null, { projectId: "A" }),
      unit("a2", null, { projectId: "A" }),
      unit("b1", null, { projectId: "B" }),
      unit("b2", null, { projectId: "B" }),
    ];
    const exam: ExamSpec = { ...inDays(0), examAt: new Date(now + 6 * HOUR) };
    expect(examQueue(units, exam, context).items.map((item) => item.cardId)).toEqual([
      "a1",
      "b1",
      "a2",
      "b2",
    ]);
  });

  it("is empty once the exam has passed", () => {
    const past: ExamSpec = { ...inDays(0), examAt: new Date(now - HOUR) };
    expect(examQueue([unit("weak", weak())], past, context).items).toEqual([]);
  });
});

describe("examSnapshot", () => {
  it("counts cards by where they stand and names the stage", () => {
    const units = [unit("strong", strong()), unit("weak", weak()), unit("new", null)];
    const snapshot = examSnapshot(units, inDays(7), context);
    expect(snapshot).toMatchObject({ stage: "learn", total: 3, unseen: 1, atRisk: 1, lockedIn: 1 });
    expect(snapshot.shareAtTarget).toBeCloseTo(1 / 3, 10);
    // Recall fades between now and the exam, and an unseen card counts as zero.
    expect(snapshot.recallNow).toBeGreaterThan(snapshot.recallAtExam);
    expect(snapshot.recallNow).toBeLessThan(2 / 3);
  });

  it("moves through strengthen, lock-in, exam day and done", () => {
    const units = [unit("weak", weak())];
    const stageAt = (examAt: Date) =>
      examSnapshot(units, { ...inDays(0), examAt }, context).stage;
    expect(stageAt(new Date(now + 7 * DAY))).toBe("strengthen");
    // Tomorrow 09:00: inside 24 hours, but tomorrow's study day has not begun.
    expect(stageAt(new Date("2026-11-10T09:00:00.000Z"))).toBe("lock-in");
    expect(stageAt(new Date(now + 3 * HOUR))).toBe("exam-day");
    expect(stageAt(new Date(now - HOUR))).toBe("done");
  });
});

describe("planExam", () => {
  const units = buildDeck({ unseen: 60, studied: 60 }, 5);
  const exam = inDays(7);

  it("repeats exactly for the same inputs", () => {
    expect(planExam(units, exam, context)).toEqual(planExam(units, exam, context));
  });

  it("forecasts every study day up to the exam and reaches the target", () => {
    const plan = planExam(units, exam, context);
    expect(plan.days.map((day) => day.date)).toEqual([
      "2026-11-09",
      "2026-11-10",
      "2026-11-11",
      "2026-11-12",
      "2026-11-13",
      "2026-11-14",
      "2026-11-15",
      "2026-11-16",
    ]);
    expect(plan.onTrack).toBe(true);
    expect(plan.projected.unseen).toBe(0);
    expect(plan.projected.recallAtExam).toBeGreaterThan(0.9);
    expect(plan.needed.peakMinutes).toBeGreaterThanOrEqual(plan.needed.typicalMinutes);
    expect(plan.needed.totalMinutes).toBeGreaterThan(0);
    // The last three days are kept free of new cards.
    expect(plan.days.slice(-3).every((day) => day.newCards === 0)).toBe(true);
  });

  it("shows what less time costs", () => {
    const plan = planExam(buildDeck({ unseen: 200, studied: 0 }, 5), inDays(2), context);
    const byMinutes = new Map(plan.curve.map((point) => [point.minutesPerDay, point.recallAtExam]));
    expect(plan.curve.map((point) => point.minutesPerDay)).toEqual([10, 20, 30, 45, 60, null]);
    expect(byMinutes.get(10)!).toBeLessThan(byMinutes.get(30)!);
    expect(byMinutes.get(30)!).toBeLessThan(byMinutes.get(null)! + 0.01);
  });

  it("holds a capped plan to its cap and says when it falls short", () => {
    const capped = planExam(
      buildDeck({ unseen: 200, studied: 0 }, 5),
      { ...inDays(2), dailyMinutesCap: 10 },
      context,
      { curve: false },
    );
    expect(capped.curve).toEqual([]);
    expect(capped.days.every((day) => day.minutes <= 10)).toBe(true);
    expect(capped.onTrack).toBe(false);
    expect(capped.projected.unseen).toBeGreaterThan(0);
  });
});

describe("nextTouchpoint", () => {
  it("is now when enough is ready", () => {
    const units = buildDeck({ unseen: 50, studied: 0 }, 2);
    const touchpoint = nextTouchpoint(units, inDays(7), context);
    expect(touchpoint.readyNow).toBeGreaterThan(0);
    expect(touchpoint.nextAt).toEqual(NOW);
    expect(touchpoint.minutesNow).toBe(Math.ceil((touchpoint.readyNow * 20) / 60));
  });

  it("is never when every card is safe", () => {
    const touchpoint = nextTouchpoint([unit("strong", strong())], inDays(7), context);
    expect(touchpoint).toMatchObject({ readyNow: 0, nextAt: null });
  });

  it("points at tomorrow when today's work is done", () => {
    const units = Array.from({ length: 10 }, (_, index) =>
      unit(`w${index}`, faded(), { todayRatings: [3] }),
    );
    const touchpoint = nextTouchpoint(units, inDays(7), context);
    expect(touchpoint.readyNow).toBe(0);
    // The study day rolls over at 04:00 UTC on the 10th.
    expect(touchpoint.nextAt!.getTime()).toBeGreaterThanOrEqual(
      Date.parse("2026-11-10T04:00:00.000Z"),
    );
    expect(touchpoint.nextAt!.getTime()).toBeLessThan(Date.parse("2026-11-10T04:30:00.000Z"));
    expect(touchpoint.nextCount).toBeGreaterThan(0);
  });

  it("times the next pass on a cram day", () => {
    const exam: ExamSpec = { ...inDays(0), examAt: new Date(now + 10 * HOUR) };
    const units = Array.from({ length: 10 }, (_, index) => {
      const seen = engine.review(engine.review(null, now - 3 * MINUTE, 1), now - 2 * MINUTE, 3);
      return unit(`c${index}`, reviewRow(seen), { todayRatings: [1, 3] });
    });
    const touchpoint = nextTouchpoint(units, exam, context);
    expect(touchpoint.readyNow).toBe(0);
    const hoursAway = (touchpoint.nextAt!.getTime() - now) / HOUR;
    expect(hoursAway).toBeGreaterThan(2);
    expect(hoursAway).toBeLessThan(3);
  });
});

describe("planner speed", () => {
  it("queues and forecasts a 3,000-card exam quickly enough for a phone", () => {
    const units = buildDeck({ unseen: 1000, studied: 2000 }, 9);
    const exam = inDays(14);
    let started = performance.now();
    examQueue(units, exam, context);
    const queueMs = performance.now() - started;
    started = performance.now();
    planExam(units, exam, context, { curve: false });
    const planMs = performance.now() - started;
    started = performance.now();
    nextTouchpoint(units, exam, context);
    const touchpointMs = performance.now() - started;
    // Generous bounds for a desktop CPU; see the measured numbers in the PR.
    expect(queueMs).toBeLessThan(500);
    expect(planMs).toBeLessThan(5000);
    expect(touchpointMs).toBeLessThan(5000);
    if (process.env.EXAM_PERF_OUT) {
      writeFileSync(
        process.env.EXAM_PERF_OUT,
        JSON.stringify({ queueMs, planMs, touchpointMs }),
      );
    }
  });
});
