import { dateChrono, defineScheduler, Rating, State } from "ts-fsrs";
import {
  schedulerDesiredRetentionMiddleware,
  schedulerFuzzingMiddleware,
  schedulerLearningStepsMiddleware,
  schedulerMaximumIntervalMiddleware,
  schedulerMonotonicIntervalMiddleware,
  schedulerScheduledDaysMiddleware,
  schedulerStatsMiddleware,
} from "ts-fsrs/middlewares";
import {
  FSRS6_DEFAULT_WEIGHTS,
  FSRS6Model,
  checkFSRS6Parameters,
  clipFSRS6Parameters,
} from "ts-fsrs/models/fsrs-6";
import {
  FSRS7_DEFAULT_WEIGHTS,
  FSRS7Model,
  checkFSRS7Parameters,
  clipFSRS7Parameters,
} from "ts-fsrs/models/fsrs-7";
import { Reschedule } from "ts-fsrs/reschedule";
import { DEFAULT_DESIRED_RETENTION } from "@deephaus/shared";

import { applyEasyDays, type EasyDaysOptions } from "./easy-days.js";

/**
 * DeepHaus schedules with FSRS-7. A card's FSRS-7 memory is best rebuilt by
 * replaying its complete review history. A card without that history (some
 * Anki imports, older rows) has its FSRS-6 memory converted instead, keeping
 * its next interval (see {@link fsrs7MemoryFromFsrs6}). Either way every card
 * is graded by FSRS-7; stored rows record which model produced their state,
 * and FSRS-6 grading remains only for memory that can't be converted.
 */
export type FsrsModelVersion = 6 | 7;
export const CURRENT_FSRS_VERSION: FsrsModelVersion = 7;
export const FSRS6_PARAM_COUNT = FSRS6_DEFAULT_WEIGHTS.length;
export const FSRS7_PARAM_COUNT = FSRS7_DEFAULT_WEIGHTS.length;

const DAY_MS = 86_400_000;
const LEARNING_STEPS = ["1m", "10m"] as const;
const RELEARNING_STEPS = ["10m"] as const;
const MAXIMUM_INTERVAL_DAYS = 36_500;
/**
 * FSRS-7 models same-day memory itself, so its interval replaces a learning
 * step whenever it is longer (the library's own FSRS-7 preset). FSRS-6 cards
 * keep the fixed steps they have always had.
 */
const FSRS7_ALLOW_MODEL_OVERRIDE = true;
/** Stored timestamps that differ by less than this are the same review. */
const SAME_REVIEW_TOLERANCE_MS = 1000;

// Same policies, in the same order, as the library's standard preset.
const fsrs7Definition = defineScheduler({ model: FSRS7Model, chrono: dateChrono }).use(
  schedulerDesiredRetentionMiddleware,
  schedulerFuzzingMiddleware,
  schedulerStatsMiddleware,
  schedulerScheduledDaysMiddleware,
  schedulerLearningStepsMiddleware,
  schedulerMaximumIntervalMiddleware,
  schedulerMonotonicIntervalMiddleware,
);
const fsrs6Definition = defineScheduler({ model: FSRS6Model, chrono: dateChrono }).use(
  schedulerDesiredRetentionMiddleware,
  schedulerFuzzingMiddleware,
  schedulerStatsMiddleware,
  schedulerScheduledDaysMiddleware,
  schedulerLearningStepsMiddleware,
  schedulerMaximumIntervalMiddleware,
  schedulerMonotonicIntervalMiddleware,
);

type Fsrs7Scheduler = ReturnType<typeof fsrs7Definition.create>;
type Fsrs6Scheduler = ReturnType<typeof fsrs6Definition.create>;
type Fsrs7Card = ReturnType<Fsrs7Scheduler["newCard"]>;
type Fsrs6Card = ReturnType<Fsrs6Scheduler["newCard"]>;

export type FsrsGrade = 1 | 2 | 3 | 4;
const GRADES: readonly FsrsGrade[] = [1, 2, 3, 4];

/** Trained weights, per model. A missing entry means that model's defaults. */
export interface FsrsWeights {
  fsrs6?: number[];
  fsrs7?: number[];
}

export interface SchedulerOptions extends EasyDaysOptions {
  weights?: FsrsWeights;
  requestRetention?: number;
  /**
   * Spread longer intervals so cards graded together don't all come back on
   * the same day. Off for readiness maths and simulations, which must repeat.
   */
  enableFuzz?: boolean;
}

/** Database row shape for public.card_reviews (subset used here). */
export interface CardReviewRow {
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: string | null;
  learning_steps: number;
  /** FSRS-7's fast memory trace. Null on FSRS-6 rows. */
  stability_fast?: number | null;
  /** Model that produced the memory values. Missing means FSRS-6. */
  fsrs_version?: number | null;
}

/** Card columns ready to be written to public.card_reviews. */
export type ReviewFields = Required<CardReviewRow>;

/** One recorded review of a scheduling unit, as stored in review_logs. */
export interface ReviewHistoryEntry {
  rating: number;
  /** The card's state before this review (0 = new). */
  state: number;
  review: string;
  undone?: boolean | number | null;
}

/** Pre-review values recorded with each review, as stored in review_logs. */
export interface ReviewLogFields {
  rating: FsrsGrade;
  state: number;
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  last_elapsed_days: number;
  scheduled_days: number;
  review: string;
}

export interface GradeInput {
  /** Stable identity of the scheduling unit, e.g. `${cardId}:${clozeOrd}`. Seeds fuzz. */
  cardKey: string;
  /** Stored state; null when the unit has never been reviewed. */
  review: CardReviewRow | null;
  /**
   * Every recorded review of this unit. When it is complete, the card's FSRS-7
   * memory is rebuilt from it. Omit it where logs aren't available: the card
   * then continues from its stored state on whichever model produced that.
   */
  history?: readonly ReviewHistoryEntry[];
  now: Date;
}

export interface GradeResult {
  next: ReviewFields;
  log: ReviewLogFields;
  /** Model the card is on after this review. */
  model: FsrsModelVersion;
  /** Time until the card is next due, in days. */
  intervalDays: number;
}

export interface IntervalPreview {
  again: string;
  hard: string;
  good: string;
  easy: string;
}

export interface DeckScheduler {
  /** Apply one rating and return the card's next state plus its log entry. */
  grade(input: GradeInput & { rating: FsrsGrade }): GradeResult;
  /** The outcome of each of the four ratings, without applying any. */
  preview(input: GradeInput): Record<FsrsGrade, GradeResult>;
  previewIntervals(input: GradeInput): IntervalPreview;
  /** Probability of recalling the card at `at`, from its stored state. */
  retrievability(review: CardReviewRow, at: Date): number;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function usableFsrs7Weights(weights: number[] | undefined): readonly number[] {
  if (!weights || weights.length !== FSRS7_PARAM_COUNT || !weights.every(isFiniteNumber)) {
    return FSRS7_DEFAULT_WEIGHTS;
  }
  try {
    return checkFSRS7Parameters(clipFSRS7Parameters(weights));
  } catch {
    return FSRS7_DEFAULT_WEIGHTS;
  }
}

export function usableFsrs6Weights(weights: number[] | undefined): readonly number[] {
  if (!weights || weights.length !== FSRS6_PARAM_COUNT || !weights.every(isFiniteNumber)) {
    return FSRS6_DEFAULT_WEIGHTS;
  }
  try {
    return checkFSRS6Parameters(
      clipFSRS6Parameters(weights, RELEARNING_STEPS.length, true),
      RELEARNING_STEPS.length,
      true,
    );
  } catch {
    return FSRS6_DEFAULT_WEIGHTS;
  }
}

/**
 * Stored weights of unknown origin (a deck preset, the local replica, a cram
 * snapshot): identify the model by length, and reject anything else so a
 * mismatched vector can never be fed to the wrong model.
 */
export function parseStoredWeights(raw: unknown): FsrsWeights {
  if (Array.isArray(raw)) {
    if (!raw.every(isFiniteNumber)) return {};
    if (raw.length === FSRS6_PARAM_COUNT) return { fsrs6: raw as number[] };
    if (raw.length === FSRS7_PARAM_COUNT) return { fsrs7: raw as number[] };
    return {};
  }
  if (raw && typeof raw === "object") {
    const { fsrs6, fsrs7 } = raw as { fsrs6?: unknown; fsrs7?: unknown };
    return {
      fsrs6: parseStoredWeights(fsrs6).fsrs6,
      fsrs7: parseStoredWeights(fsrs7).fsrs7,
    };
  }
  return {};
}

/**
 * Weights for a deck: a deck-level preset (e.g. imported with an Anki deck)
 * wins over the user's own fit for the model it belongs to, and each model
 * falls back to its defaults.
 */
export function resolveWeights(deckParams: unknown, userWeights?: FsrsWeights): FsrsWeights {
  const deck = parseStoredWeights(deckParams);
  return {
    fsrs6: deck.fsrs6 ?? userWeights?.fsrs6,
    fsrs7: deck.fsrs7 ?? userWeights?.fsrs7,
  };
}

function historyTime(entry: ReviewHistoryEntry): number {
  return Date.parse(entry.review);
}

/** Graded, not-undone reviews in the order they happened. */
function gradedHistory(history: readonly ReviewHistoryEntry[]): ReviewHistoryEntry[] {
  return history
    .filter(
      (entry) =>
        !entry.undone &&
        entry.rating >= 1 &&
        entry.rating <= 4 &&
        Number.isFinite(historyTime(entry)),
    )
    .sort((a, b) => historyTime(a) - historyTime(b));
}

/**
 * Whether these logs are everything that has happened to the card since it was
 * new: the first review found it new, and the last one is the review that
 * produced the stored state. Anything less (an import that brought scheduling
 * state without its reviews, a truncated log) is not safe to rebuild from.
 */
export function isCompleteHistory(
  history: readonly ReviewHistoryEntry[],
  review: Pick<CardReviewRow, "last_review">,
): boolean {
  const graded = gradedHistory(history);
  if (graded.length === 0 || graded[0]!.state !== State.New) return false;
  if (!review.last_review) return false;
  const lastReview = Date.parse(review.last_review);
  return (
    Math.abs(historyTime(graded[graded.length - 1]!) - lastReview) <= SAME_REVIEW_TOLERANCE_MS
  );
}

/** Whether a stored row holds a usable FSRS-7 memory state. */
export function hasFsrs7Memory(review: CardReviewRow): boolean {
  return (
    review.fsrs_version === 7 &&
    isFiniteNumber(review.stability_fast) &&
    review.stability_fast > 0 &&
    review.stability > 0
  );
}

/** FSRS-7's memory: a slow and a fast trace plus difficulty. */
export interface Fsrs7Memory {
  stability: number;
  stabilityFast: number;
  difficulty: number;
}

/**
 * Fast-to-slow trace ratio a converted card starts with, by state. These are
 * what replayed histories typically show: about 0.8 on a first learning step,
 * about 0.25 just after a lapse, and about 10 for a card in review.
 */
const CONVERTED_FAST_RATIO: Record<1 | 2 | 3, number> = { 1: 0.8, 2: 10, 3: 0.25 };
/** FSRS-6 defines stability as the days until recall falls to this. */
const FSRS6_STABILITY_RECALL = 0.9;
const MIN_CONVERTED_STABILITY = 1e-3;

/**
 * FSRS-7 memory for a card that only has FSRS-6 memory (an Anki import
 * without its full review history, or a card graded before FSRS-7).
 *
 * FSRS-7 memory can't be read off FSRS-6's: it has two traces and its
 * stability means something else. So the conversion keeps difficulty, starts
 * the traces at the ratio typical of the card's state, and solves for the
 * stability that puts 90% recall on the same day FSRS-6 does. The card's
 * next interval is unchanged, and from its next review on it learns as an
 * FSRS-7 card.
 *
 * `curve` is FSRS-7's forgetting curve under the weights in use.
 */
export function fsrs7MemoryFromFsrs6(
  memory: { stability: number; difficulty: number; state: number },
  curve: (memory: Fsrs7Memory, elapsedDays: number) => number,
): Fsrs7Memory | null {
  if (!isFiniteNumber(memory.stability) || memory.stability <= 0) return null;
  const state = clampState(memory.state);
  const ratio = state === State.New ? CONVERTED_FAST_RATIO[2] : CONVERTED_FAST_RATIO[state];
  const difficulty = Math.max(
    1,
    Math.min(10, isFiniteNumber(memory.difficulty) && memory.difficulty > 0 ? memory.difficulty : 5),
  );
  const target = Math.min(memory.stability, MAXIMUM_INTERVAL_DAYS);
  const at = (stability: number): Fsrs7Memory => ({
    stability,
    stabilityFast: Math.min(MAXIMUM_INTERVAL_DAYS, Math.max(1e-4, stability * ratio)),
    difficulty,
  });
  const recallAt = (logStability: number) => curve(at(Math.exp(logStability)), target);

  let low = Math.log(MIN_CONVERTED_STABILITY);
  let high = Math.log(MAXIMUM_INTERVAL_DAYS);
  if (recallAt(high) < FSRS6_STABILITY_RECALL) return at(MAXIMUM_INTERVAL_DAYS);
  if (recallAt(low) >= FSRS6_STABILITY_RECALL) return at(MIN_CONVERTED_STABILITY);
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2;
    if (recallAt(mid) < FSRS6_STABILITY_RECALL) low = mid;
    else high = mid;
  }
  return at(Math.exp(high));
}

/** FSRS-7 memory under default-or-given weights, for code without a scheduler (imports). */
export function convertToFsrs7Memory(
  memory: { stability: number; difficulty: number; state: number },
  fsrs7Weights?: number[],
): Fsrs7Memory | null {
  const model = createFsrs7(fsrs7Weights, DEFAULT_DESIRED_RETENTION, false).model;
  return fsrs7MemoryFromFsrs6(memory, (state, elapsed) => model.forgettingCurve(state, elapsed));
}

const SCHEDULE_STATUS = {
  [State.New]: "new",
  [State.Learning]: "learning",
  [State.Review]: "review",
  [State.Relearning]: "learning",
} as const;

function clampState(state: number): 0 | 1 | 2 | 3 {
  return state === 1 || state === 2 || state === 3 ? state : 0;
}

function createFsrs7(weights: number[] | undefined, desiredRetention: number, enableFuzz: boolean) {
  return fsrs7Definition.create({
    config: {
      weights: usableFsrs7Weights(weights),
      fractionalDays: true,
      desiredRetention,
      enableShortTerm: true,
      learningSteps: [...LEARNING_STEPS],
      relearningSteps: [...RELEARNING_STEPS],
      allowModelOverride: FSRS7_ALLOW_MODEL_OVERRIDE,
      enableFuzz,
      maximumInterval: MAXIMUM_INTERVAL_DAYS,
      clearStatsOnForget: false,
    },
  });
}

function createFsrs6(weights: number[] | undefined, desiredRetention: number, enableFuzz: boolean) {
  return fsrs6Definition.create({
    config: {
      weights: [...usableFsrs6Weights(weights)],
      // FSRS-6 measures elapsed time in whole days, as it always has here.
      fractionalDays: false,
      numRelearningSteps: RELEARNING_STEPS.length,
      desiredRetention,
      enableShortTerm: true,
      learningSteps: [...LEARNING_STEPS],
      relearningSteps: [...RELEARNING_STEPS],
      enableFuzz,
      maximumInterval: MAXIMUM_INTERVAL_DAYS,
      clearStatsOnForget: false,
    },
  });
}

type Prepared =
  | { model: 7; card: Fsrs7Card; previous: CardReviewRow | null }
  | { model: 6; card: Fsrs6Card; previous: CardReviewRow | null };

/**
 * Build an FSRS scheduler for one deck's settings. Cheap to create, so callers
 * make one per request rather than caching globally — each user and deck can
 * have its own weights and retention target.
 */
export function buildScheduler(options: SchedulerOptions = {}): DeckScheduler {
  const desiredRetention = options.requestRetention ?? DEFAULT_DESIRED_RETENTION;
  const enableFuzz = options.enableFuzz ?? true;
  const fsrs7 = createFsrs7(options.weights?.fsrs7, desiredRetention, enableFuzz);
  // Created on first use: most decks have no FSRS-6 cards left.
  let fsrs6: Fsrs6Scheduler | undefined;
  const getFsrs6 = () =>
    (fsrs6 ??= createFsrs6(options.weights?.fsrs6, desiredRetention, enableFuzz));
  const easyDaysActive = Boolean(options.easyDays?.some((day) => day !== "normal"));
  const fsrs7Curve = (memory: Fsrs7Memory, elapsedDays: number) =>
    fsrs7.model.forgettingCurve(memory, elapsedDays);

  /** A stored row's memory as FSRS-7, converting FSRS-6 memory when that's all it has. */
  function toFsrs7(review: CardReviewRow): Fsrs7Memory | null {
    if (hasFsrs7Memory(review)) {
      return {
        stability: review.stability,
        stabilityFast: review.stability_fast as number,
        difficulty: review.difficulty,
      };
    }
    return fsrs7MemoryFromFsrs6(review, fsrs7Curve);
  }

  function prepare(input: GradeInput): Prepared {
    const { review, now, cardKey } = input;
    if (!review || clampState(review.state) === State.New) {
      const fresh = fsrs7.newCard({ cardId: cardKey, now });
      return {
        model: 7,
        previous: review,
        card: {
          ...fresh,
          dueAt: review ? new Date(review.due) : now,
          reps: review?.reps ?? 0,
          lapses: review?.lapses ?? 0,
        },
      };
    }

    const state = clampState(review.state);
    const due = new Date(review.due);
    // A delayed answer can predate the stored state; elapsed time stays nonnegative.
    const lastReviewMs = review.last_review ? Date.parse(review.last_review) : due.getTime();
    const lastReviewAt = new Date(Math.min(lastReviewMs, now.getTime()));
    const schedule = {
      cardId: cardKey,
      dueAt: due,
      lastReviewAt,
      state,
      scheduleStatus: SCHEDULE_STATUS[state],
      scheduledDays: Math.max(0, review.scheduled_days ?? 0),
      learningStep: Math.max(0, review.learning_steps ?? 0),
      reps: review.reps ?? 0,
      lapses: review.lapses ?? 0,
    };

    const graded = input.history ? gradedHistory(input.history) : [];
    const answeredInOrder =
      graded.length > 0 && historyTime(graded[graded.length - 1]!) <= now.getTime();
    if (input.history && answeredInOrder && isCompleteHistory(input.history, review)) {
      const { memoryState } = new Reschedule(fsrs7).replay({
        history: graded.map((entry) => ({
          rating: entry.rating as FsrsGrade,
          reviewTime: new Date(historyTime(entry)),
        })),
      });
      if (memoryState) {
        return { model: 7, previous: review, card: { ...schedule, ...memoryState } };
      }
    }

    if (hasFsrs7Memory(review)) {
      return {
        model: 7,
        previous: review,
        card: {
          ...schedule,
          stability: review.stability,
          stabilityFast: review.stability_fast as number,
          difficulty: review.difficulty,
        },
      };
    }

    // FSRS-6 memory without a history to rebuild from: converted, so every
    // card is graded by FSRS-7 from its next review on.
    const converted = toFsrs7(review);
    if (converted) {
      return { model: 7, previous: review, card: { ...schedule, ...converted } };
    }

    return {
      model: 6,
      previous: review,
      card: { ...schedule, stability: review.stability, difficulty: review.difficulty },
    };
  }

  function candidates(input: GradeInput): Record<FsrsGrade, GradeResult> {
    const prepared = prepare(input);
    const { now } = input;
    const previous = prepared.previous;
    const wasNew = !previous || clampState(previous.state) === State.New;
    const out = {} as Record<FsrsGrade, GradeResult>;

    const record = (
      grade: FsrsGrade,
      next: Fsrs7Card | Fsrs6Card,
      elapsedDays: number,
      memory: { stability: number; difficulty: number },
    ) => {
      out[grade] = {
        model: prepared.model,
        intervalDays: Math.max(0, (next.dueAt.getTime() - now.getTime()) / DAY_MS),
        next: {
          due: next.dueAt.toISOString(),
          stability: next.stability,
          stability_fast: "stabilityFast" in next ? next.stabilityFast : null,
          difficulty: next.difficulty,
          elapsed_days: elapsedDays,
          scheduled_days: next.scheduledDays,
          learning_steps: next.learningStep,
          reps: next.reps,
          lapses: next.lapses,
          state: next.state,
          last_review: (next.lastReviewAt ?? now).toISOString(),
          fsrs_version: prepared.model,
        },
        log: {
          rating: grade,
          state: wasNew ? State.New : clampState(previous.state),
          due: (wasNew || !previous.last_review ? prepared.card.dueAt : new Date(previous.last_review)).toISOString(),
          stability: memory.stability,
          difficulty: memory.difficulty,
          elapsed_days: elapsedDays,
          last_elapsed_days: previous?.elapsed_days ?? 0,
          scheduled_days: previous?.scheduled_days ?? 0,
          review: now.toISOString(),
        },
      };
    };

    if (prepared.model === 7) {
      const elapsedDays =
        wasNew || !prepared.card.lastReviewAt
          ? 0
          : fsrs7.chrono.difference(prepared.card.lastReviewAt, now);
      for (const candidate of fsrs7.preview({ card: prepared.card, now })) {
        record(candidate.grade as FsrsGrade, candidate.card, elapsedDays, prepared.card);
      }
    } else {
      const scheduler = getFsrs6();
      const elapsedDays = prepared.card.lastReviewAt
        ? scheduler.chrono.difference(prepared.card.lastReviewAt, now)
        : 0;
      for (const candidate of scheduler.preview({ card: prepared.card, now })) {
        record(candidate.grade as FsrsGrade, candidate.card, elapsedDays, prepared.card);
      }
    }

    if (easyDaysActive) {
      applyEasyDays(
        GRADES.map((grade) => out[grade]),
        options,
      );
    }
    return out;
  }

  return {
    preview: candidates,
    grade: (input) => candidates(input)[input.rating],
    previewIntervals(input) {
      const preview = candidates(input);
      return {
        again: formatInterval(preview[Rating.Again].intervalDays),
        hard: formatInterval(preview[Rating.Hard].intervalDays),
        good: formatInterval(preview[Rating.Good].intervalDays),
        easy: formatInterval(preview[Rating.Easy].intervalDays),
      };
    },
    retrievability(review, at) {
      if (clampState(review.state) === State.New || !review.last_review) return 0;
      const last = new Date(Math.min(Date.parse(review.last_review), at.getTime()));
      const memory = toFsrs7(review);
      const value = memory ? fsrs7Curve(memory, fsrs7.chrono.difference(last, at)) : 0;
      return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    },
  };
}

/**
 * Rebuild a card's memory under one model from its complete review history.
 * Returns null when the history has no graded review to replay.
 */
export function replayMemory(
  model: FsrsModelVersion,
  history: readonly ReviewHistoryEntry[],
  weights?: FsrsWeights,
): { stability: number; difficulty: number; stability_fast: number | null } | null {
  const graded = gradedHistory(history).map((entry) => ({
    rating: entry.rating as FsrsGrade,
    reviewTime: new Date(historyTime(entry)),
  }));
  if (graded.length === 0) return null;
  if (model === 7) {
    const scheduler = createFsrs7(weights?.fsrs7, DEFAULT_DESIRED_RETENTION, false);
    const { memoryState } = new Reschedule(scheduler).replay({ history: graded });
    return memoryState
      ? {
          stability: memoryState.stability,
          difficulty: memoryState.difficulty,
          stability_fast: memoryState.stabilityFast,
        }
      : null;
  }
  const scheduler = createFsrs6(weights?.fsrs6, DEFAULT_DESIRED_RETENTION, false);
  const { memoryState } = new Reschedule(scheduler).replay({ history: graded });
  return memoryState
    ? { stability: memoryState.stability, difficulty: memoryState.difficulty, stability_fast: null }
    : null;
}

/** State for a unit that has no reviews yet (e.g. one suspended before first study). */
export function newReviewFields(now: Date = new Date()): ReviewFields {
  return {
    due: now.toISOString(),
    stability: 0,
    stability_fast: null,
    difficulty: 0,
    elapsed_days: 0,
    scheduled_days: 0,
    learning_steps: 0,
    reps: 0,
    lapses: 0,
    state: State.New,
    last_review: null,
    fsrs_version: CURRENT_FSRS_VERSION,
  };
}

export type GradeLabel = "again" | "hard" | "good" | "easy";

const RATING_BY_GRADE: Record<GradeLabel, FsrsGrade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

export function gradeToRating(grade: GradeLabel): FsrsGrade {
  return RATING_BY_GRADE[grade];
}

export function isValidGrade(rating: number): rating is FsrsGrade {
  return rating === 1 || rating === 2 || rating === 3 || rating === 4;
}

/** Human-readable interval label for grade buttons. */
export function formatInterval(scheduledDays: number): string {
  if (scheduledDays < 1 / 1440) return "< 1m";
  if (scheduledDays < 1 / 24) {
    const minutes = Math.max(1, Math.round(scheduledDays * 1440));
    return `${minutes}m`;
  }
  if (scheduledDays < 1) {
    const hours = Math.max(1, Math.round(scheduledDays * 24));
    return `${hours}h`;
  }
  if (scheduledDays < 30) {
    return `${Math.round(scheduledDays)}d`;
  }
  if (scheduledDays < 365) {
    return `${Math.round(scheduledDays / 30)}mo`;
  }
  return `${(scheduledDays / 365).toFixed(1)}y`;
}

export { Rating, State, DEFAULT_DESIRED_RETENTION };
