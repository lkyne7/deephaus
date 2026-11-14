import { describe, expect, it } from "vitest";
import {
  FSRS6_PARAM_COUNT,
  FSRS7_PARAM_COUNT,
  Rating,
  State,
  buildScheduler,
  hasFsrs7Memory,
  isCompleteHistory,
  newReviewFields,
  parseStoredWeights,
  replayMemory,
  resolveWeights,
  type CardReviewRow,
  type FsrsGrade,
  type ReviewFields,
  type ReviewHistoryEntry,
} from "../../packages/scheduling/src/index";

const HOUR = 3_600_000;
const start = new Date("2026-01-01T09:00:00.000Z");
const cardKey = "card-1:0";

/**
 * The same eight reviews run through ts-fsrs 5.4.1 (FSRS-6, default weights,
 * no fuzz), captured before the upgrade. Cards that stay on FSRS-6 must keep
 * producing exactly these results.
 */
const FSRS6_REFERENCE = [
  { rating: 3, at: "2026-01-01T09:00:00.000Z", stability: 2.3065, difficulty: 2.11810397, due: "2026-01-01T09:10:00.000Z", state: 1, reps: 1, lapses: 0, learning_steps: 1 },
  { rating: 3, at: "2026-01-01T14:10:00.000Z", stability: 2.3065, difficulty: 2.11121424, due: "2026-01-03T14:10:00.000Z", state: 2, reps: 2, lapses: 0, learning_steps: 0 },
  { rating: 3, at: "2026-01-03T19:10:00.000Z", stability: 10.97104786, difficulty: 2.1043314, due: "2026-01-14T19:10:00.000Z", state: 2, reps: 3, lapses: 0, learning_steps: 0 },
  { rating: 2, at: "2026-01-15T00:10:00.000Z", stability: 33.57683091, difficulty: 4.74371562, due: "2026-02-18T00:10:00.000Z", state: 2, reps: 4, lapses: 0, learning_steps: 0 },
  { rating: 1, at: "2026-02-18T05:10:00.000Z", stability: 2.44919476, difficulty: 8.25752343, due: "2026-02-18T05:20:00.000Z", state: 3, reps: 5, lapses: 1, learning_steps: 0 },
  { rating: 3, at: "2026-02-18T10:20:00.000Z", stability: 2.44919476, difficulty: 8.24449428, due: "2026-02-20T10:20:00.000Z", state: 2, reps: 6, lapses: 1, learning_steps: 0 },
  { rating: 3, at: "2026-02-20T15:20:00.000Z", stability: 5.14984791, difficulty: 8.23147816, due: "2026-02-25T15:20:00.000Z", state: 2, reps: 7, lapses: 1, learning_steps: 0 },
  { rating: 4, at: "2026-02-25T20:20:00.000Z", stability: 15.86932684, difficulty: 7.62574894, due: "2026-03-13T20:20:00.000Z", state: 2, reps: 8, lapses: 1, learning_steps: 0 },
] as const;

function fsrs6Row(index: number): CardReviewRow {
  const ref = FSRS6_REFERENCE[index]!;
  return {
    due: ref.due,
    stability: ref.stability,
    difficulty: ref.difficulty,
    elapsed_days: 0,
    scheduled_days: 0,
    reps: ref.reps,
    lapses: ref.lapses,
    state: ref.state,
    last_review: ref.at,
    learning_steps: ref.learning_steps,
  };
}

/** Grade a fresh card through `ratings`, each review five hours after it falls due. */
function study(ratings: FsrsGrade[], scheduler = buildScheduler({ enableFuzz: false })) {
  let review: ReviewFields | null = null;
  let now = start;
  const history: ReviewHistoryEntry[] = [];
  for (const rating of ratings) {
    const result = scheduler.grade({ cardKey, review, history, now, rating });
    history.push({ rating, state: result.log.state, review: result.log.review });
    review = result.next;
    now = new Date(Date.parse(review.due) + 5 * HOUR);
  }
  return { review: review!, history, now };
}

describe("FSRS-7 scheduling", () => {
  it("starts new cards on FSRS-7 with both memory traces", () => {
    const scheduler = buildScheduler({ enableFuzz: false });
    const preview = scheduler.preview({ cardKey, review: null, now: start });
    for (const grade of [1, 2, 3, 4] as const) {
      expect(preview[grade].model).toBe(7);
      expect(preview[grade].next.fsrs_version).toBe(7);
      expect(preview[grade].next.stability_fast).toBeGreaterThan(0);
      expect(preview[grade].next.reps).toBe(1);
      expect(preview[grade].log).toMatchObject({ state: State.New, elapsed_days: 0 });
    }
    const days = ([1, 2, 3, 4] as const).map((grade) => preview[grade].intervalDays);
    expect(days[0]).toBeLessThan(days[1]!);
    expect(days[1]).toBeLessThan(days[2]!);
    expect(days[2]).toBeLessThan(days[3]!);
    // Again comes back within the session; Good is the model's own interval.
    expect(preview[Rating.Again].next.state).toBe(State.Learning);
    expect(preview[Rating.Good].next.state).toBe(State.Review);
  });

  it("keeps fractional intervals and elapsed time", () => {
    const scheduler = buildScheduler({ enableFuzz: false });
    const first = scheduler.grade({ cardKey, review: null, now: start, rating: Rating.Hard });
    expect(first.next.scheduled_days).toBeGreaterThan(0);
    expect(first.next.scheduled_days).toBeLessThan(1);
    expect(Date.parse(first.next.due) - start.getTime()).toBeCloseTo(
      first.next.scheduled_days * 86_400_000,
      -1,
    );
    const later = new Date(start.getTime() + 6 * HOUR);
    const second = scheduler.grade({
      cardKey,
      review: first.next,
      history: [{ rating: 2, state: 0, review: start.toISOString() }],
      now: later,
      rating: Rating.Good,
    });
    expect(second.next.elapsed_days).toBeCloseTo(0.25, 6);
    expect(second.log.elapsed_days).toBeCloseTo(0.25, 6);
  });

  it("gives the same result for a preview and the grade that follows it", () => {
    const scheduler = buildScheduler();
    const { review, history, now } = study([3, 3, 3]);
    const preview = scheduler.preview({ cardKey, review, history, now });
    for (const rating of [1, 2, 3, 4] as const) {
      expect(scheduler.grade({ cardKey, review, history, now, rating })).toEqual(preview[rating]);
    }
  });

  it("records the pre-review state in the log", () => {
    const scheduler = buildScheduler({ enableFuzz: false });
    const { review, history, now } = study([3, 3]);
    const result = scheduler.grade({ cardKey, review, history, now, rating: Rating.Again });
    expect(result.log).toMatchObject({
      rating: 1,
      state: review.state,
      due: review.last_review,
      stability: review.stability,
      difficulty: review.difficulty,
      scheduled_days: review.scheduled_days,
      review: now.toISOString(),
    });
    expect(result.next.lapses).toBe(review.lapses + 1);
    expect(result.next.last_review).toBe(now.toISOString());
  });
});

describe("moving existing cards to FSRS-7", () => {
  it("rebuilds memory from complete history without touching the schedule", () => {
    const scheduler = buildScheduler({ enableFuzz: false });
    const ratings: FsrsGrade[] = [3, 3, 2, 1, 3];
    const native = study(ratings);

    // The same card as an FSRS-6 client left it: FSRS-6 memory, no fast trace.
    const legacy: CardReviewRow = {
      ...native.review,
      stability: 4.2,
      difficulty: 6.1,
      stability_fast: null,
      fsrs_version: 6,
    };
    const rebuilt = scheduler.grade({
      cardKey,
      review: legacy,
      history: native.history,
      now: native.now,
      rating: Rating.Good,
    });
    const expected = scheduler.grade({
      cardKey,
      review: native.review,
      history: native.history,
      now: native.now,
      rating: Rating.Good,
    });
    expect(rebuilt).toEqual(expected);
    expect(rebuilt.model).toBe(7);
    // The log shows the rebuilt FSRS-7 memory the grade started from.
    expect(rebuilt.log.stability).toBeCloseTo(native.review.stability, 8);
    expect(rebuilt.next.reps).toBe(legacy.reps + 1);
    expect(rebuilt.log.scheduled_days).toBe(legacy.scheduled_days);

    expect(replayMemory(7, native.history)).toEqual({
      stability: native.review.stability,
      difficulty: native.review.difficulty,
      stability_fast: native.review.stability_fast,
    });
  });

  it("converts a card to FSRS-7 when its history is missing or truncated", () => {
    const scheduler = buildScheduler({ enableFuzz: false });
    const row = fsrs6Row(3);
    const now = new Date(Date.parse(row.due) + 5 * HOUR);
    const truncated: ReviewHistoryEntry[] = [
      // Starts mid-life: the card was already in review when this log was written.
      { rating: 3, state: State.Review, review: FSRS6_REFERENCE[2]!.at },
      { rating: 2, state: State.Review, review: FSRS6_REFERENCE[3]!.at },
    ];
    const stale: ReviewHistoryEntry[] = [
      { rating: 3, state: State.New, review: FSRS6_REFERENCE[0]!.at },
      // The review that produced the stored state is not in the log.
      { rating: 3, state: State.Learning, review: FSRS6_REFERENCE[1]!.at },
    ];
    expect(isCompleteHistory(truncated, row)).toBe(false);
    expect(isCompleteHistory(stale, row)).toBe(false);
    expect(isCompleteHistory([], row)).toBe(false);

    // Nothing to rebuild from, so its FSRS-6 memory is converted: recall
    // still reaches 90% on the day FSRS-6 put it, and grading is FSRS-7's.
    const lastReview = Date.parse(row.last_review!);
    expect(
      scheduler.retrievability(row, new Date(lastReview + row.stability * 24 * HOUR)),
    ).toBeCloseTo(0.9, 3);
    for (const history of [undefined, [], truncated, stale]) {
      const result = scheduler.grade({ cardKey, review: row, history, now, rating: Rating.Again });
      expect(result.model).toBe(7);
      expect(result.next.fsrs_version).toBe(7);
      expect(result.next.stability_fast).toBeGreaterThan(0);
    }
  });

  it("grades every FSRS-6 card on FSRS-7, and still replays FSRS-6 memory as before", () => {
    const scheduler = buildScheduler({ enableFuzz: false });
    const ref = FSRS6_REFERENCE[1]!;
    const result = scheduler.grade({
      cardKey,
      review: fsrs6Row(0),
      now: new Date(ref.at),
      rating: ref.rating as FsrsGrade,
    });
    expect(result.model).toBe(7);
    expect(result.next).toMatchObject({ reps: ref.reps, lapses: ref.lapses, last_review: ref.at });
    const history = FSRS6_REFERENCE.map((ref, index) => ({
      rating: ref.rating,
      state: index === 0 ? State.New : FSRS6_REFERENCE[index - 1]!.state,
      review: ref.at,
    }));
    const replayed = replayMemory(6, history);
    expect(replayed?.stability).toBeCloseTo(FSRS6_REFERENCE[7]!.stability, 7);
    expect(replayed?.difficulty).toBeCloseTo(FSRS6_REFERENCE[7]!.difficulty, 7);
    expect(replayed?.stability_fast).toBeNull();
  });

  it("ignores undone reviews when rebuilding", () => {
    const { review, history, now } = study([3, 3, 3]);
    const scheduler = buildScheduler({ enableFuzz: false });
    const withUndone: ReviewHistoryEntry[] = [
      ...history,
      { rating: 1, state: State.Review, review: new Date(now.getTime() - HOUR).toISOString(), undone: 1 },
    ];
    expect(isCompleteHistory(withUndone, review)).toBe(true);
    expect(scheduler.grade({ cardKey, review, history: withUndone, now, rating: 3 })).toEqual(
      scheduler.grade({ cardKey, review, history, now, rating: 3 }),
    );
  });

  it("repairs a card an older app graded with FSRS-6", () => {
    const scheduler = buildScheduler({ enableFuzz: false });
    const { review, history, now } = study([3, 3, 3]);
    // An FSRS-6 client reviews the card: it logs the review but stores FSRS-6 memory.
    const oldClientAt = now;
    const overwritten: CardReviewRow = {
      ...review,
      stability: 9.9,
      difficulty: 4.4,
      stability_fast: null,
      fsrs_version: 6,
      reps: review.reps + 1,
      last_review: oldClientAt.toISOString(),
      due: new Date(oldClientAt.getTime() + 20 * 24 * HOUR).toISOString(),
      scheduled_days: 20,
    };
    const fullHistory = [
      ...history,
      { rating: 3, state: State.Review, review: oldClientAt.toISOString() },
    ];
    const later = new Date(Date.parse(overwritten.due) + HOUR);
    const healed = scheduler.grade({
      cardKey,
      review: overwritten,
      history: fullHistory,
      now: later,
      rating: Rating.Good,
    });
    expect(healed.model).toBe(7);
    const truth = replayMemory(7, fullHistory)!;
    expect(healed.log.stability).toBeCloseTo(truth.stability, 8);
    expect(hasFsrs7Memory(healed.next)).toBe(true);
  });

  it("continues an FSRS-7 card from its stored state when logs aren't available", () => {
    const scheduler = buildScheduler({ enableFuzz: false });
    const { review, history, now } = study([3, 3, 3]);
    const withLogs = scheduler.grade({ cardKey, review, history, now, rating: 3 });
    const withoutLogs = scheduler.grade({ cardKey, review, now, rating: 3 });
    expect(withoutLogs).toEqual(withLogs);
  });

  it("accepts an answer timestamped before the stored review", () => {
    const scheduler = buildScheduler({ enableFuzz: false });
    const { review, history } = study([3, 3]);
    const early = new Date(Date.parse(review.last_review!) - HOUR);
    const result = scheduler.grade({ cardKey, review, history, now: early, rating: 3 });
    expect(result.next.elapsed_days).toBe(0);
    expect(Number.isFinite(result.next.stability)).toBe(true);
  });
});

describe("recall probability", () => {
  it("reads each card with the model that produced its state", () => {
    const scheduler = buildScheduler({ enableFuzz: false });
    const { review } = study([3, 3, 3]);
    const at = new Date(review.due);
    // An FSRS-7 card is scheduled to fall to the 90% target when it comes due.
    expect(scheduler.retrievability(review, at)).toBeCloseTo(0.9, 2);
    expect(scheduler.retrievability(review, new Date(review.last_review!))).toBeGreaterThan(0.99);

    const legacy = fsrs6Row(3);
    expect(scheduler.retrievability(legacy, new Date(legacy.due))).toBeCloseTo(0.9, 2);
    // FSRS-6 values must not be read through the FSRS-7 curve.
    const mislabeled = { ...legacy, fsrs_version: 7, stability_fast: null };
    expect(scheduler.retrievability(mislabeled, new Date(legacy.due))).toBeCloseTo(0.9, 2);

    expect(scheduler.retrievability(newReviewFields(start), start)).toBe(0);
  });
});

describe("weights", () => {
  const six = Array.from({ length: FSRS6_PARAM_COUNT }, () => 1);
  const seven = Array.from({ length: FSRS7_PARAM_COUNT }, () => 1);

  it("identifies stored weights by model and rejects everything else", () => {
    expect(FSRS6_PARAM_COUNT).toBe(21);
    expect(FSRS7_PARAM_COUNT).toBe(34);
    expect(parseStoredWeights(six)).toEqual({ fsrs6: six });
    expect(parseStoredWeights(seven)).toEqual({ fsrs7: seven });
    expect(parseStoredWeights({ fsrs6: six, fsrs7: seven })).toEqual({ fsrs6: six, fsrs7: seven });
    expect(parseStoredWeights([1, 2, 3])).toEqual({});
    expect(parseStoredWeights([...six.slice(1), "x"])).toEqual({});
    expect(parseStoredWeights(null)).toEqual({});
    expect(parseStoredWeights("[1]")).toEqual({});
  });

  it("prefers a deck preset for its own model only", () => {
    const user = { fsrs6: six.map(() => 2), fsrs7: seven.map(() => 2) };
    expect(resolveWeights(six, user)).toEqual({ fsrs6: six, fsrs7: user.fsrs7 });
    expect(resolveWeights(undefined, user)).toEqual(user);
    expect(resolveWeights([1, 2], undefined)).toEqual({ fsrs6: undefined, fsrs7: undefined });
  });

  it("falls back to defaults when weights are unusable", () => {
    const defaults = buildScheduler({ enableFuzz: false });
    const broken = buildScheduler({
      enableFuzz: false,
      weights: { fsrs7: [1, 2, 3], fsrs6: seven },
    });
    const input = { cardKey, review: null, now: start } as const;
    expect(broken.preview(input)).toEqual(defaults.preview(input));
    const legacy = { cardKey, review: fsrs6Row(3), now: new Date(fsrs6Row(3).due) };
    expect(broken.preview(legacy)).toEqual(defaults.preview(legacy));
  });

  it("applies trained FSRS-7 weights", () => {
    const tuned = buildScheduler({
      enableFuzz: false,
      weights: {
        fsrs7: [
          0.2, 1.1, 2.5, 8, 6.1686, 0.6457, 3.6807, 1.9795, 0, 1.3826, 0.7024, 0.5999, 0.8146,
          0.6398, 1, 1.3207, 0.6707, 3.8668, 0.4416, 0.0934, 1.8631, 0.6162, 1.0869, 0.1567,
          0.0801, 0.2421, 0.9464, 0.1433, 0.7145, 0, 0.5667, 0.3734, 0.5333, 0.3048,
        ],
      },
    });
    const defaults = buildScheduler({ enableFuzz: false });
    const input = { cardKey, review: null, now: start, rating: Rating.Good } as const;
    expect(tuned.grade(input).next.stability).toBe(2.5);
    expect(defaults.grade(input).next.stability).not.toBe(2.5);
  });
});
