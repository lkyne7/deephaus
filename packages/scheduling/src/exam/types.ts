import type { EasyDays } from "@deephaus/shared";

import type { CardReviewRow, FsrsGrade, FsrsWeights } from "../fsrs.js";

/**
 * One thing a student can be asked: a card, or one cloze/occlusion ordinal of
 * it. It carries the card's real memory; an exam never keeps its own copy.
 */
export interface ExamUnit {
  /** Stable identity, e.g. `${cardId}:${clozeOrd}`. */
  key: string;
  /** Groups siblings of one note so they aren't shown back to back. */
  cardId: string;
  /** The deck, which decides the FSRS weights. */
  projectId: string;
  /** Stored memory; null (or state 0) when never reviewed. */
  review: CardReviewRow | null;
  /**
   * Grades given to this unit since the current study day began, oldest first.
   * When omitted, a review dated today counts as one pass of unknown grade.
   */
  todayRatings?: readonly FsrsGrade[];
}

export interface ExamSpec {
  examAt: Date;
  /** Recall the student wants at exam time, 0.70 to 0.97. */
  targetRecall: number;
  /** Null lets the planner say how long is needed. */
  dailyMinutesCap: number | null;
}

export interface ExamContext {
  now: Date;
  weightsByProject?: ReadonlyMap<string, FsrsWeights>;
  /** Weights for decks missing from `weightsByProject`. */
  defaultWeights?: FsrsWeights;
  timezone?: string | null;
  dayStartHour?: number;
  easyDays?: EasyDays;
  /** The student's own pace; defaults to 20 s. */
  secondsPerReview?: number;
  policy?: Partial<ExamPolicy>;
}

/** Why a card is in the queue. */
export type ExamReason =
  /** A learning or relearning step has come due. */
  | "learning"
  /** Met today for the first time and not yet recalled often enough to stick. */
  | "first-learning"
  /** Recall has faded far enough that a review now builds lasting strength. */
  | "strengthen"
  /** Final hours: everything still below target, best payoff first. */
  | "lock-in"
  /** Never seen. */
  | "new";

export type ExamStage = "learn" | "strengthen" | "lock-in" | "exam-day" | "done";

export interface ExamQueueItem {
  key: string;
  cardId: string;
  projectId: string;
  reason: ExamReason;
  /** Predicted recall right now (0 for unseen cards). */
  recallNow: number;
  /** Predicted recall at exam time with no further study. */
  recallAtExam: number;
  /** Expected rise in exam-time recall from reviewing it now. */
  gain: number;
}

export interface ExamQueue {
  items: ExamQueueItem[];
  /** Ready cards left out because today's time cap is spent. */
  skipped: number;
  /** When the next card not yet ready becomes ready, if that is today. */
  nextReadyAt: Date | null;
  /** New cards still to introduce today under the pacing rule. */
  newAllowance: number;
  /**
   * True when nothing was ready and the items are learning steps pulled
   * forward from the next few minutes, so a session does not stall on them.
   */
  learnAhead: boolean;
}

export interface ExamSnapshot {
  stage: ExamStage;
  total: number;
  unseen: number;
  /** Seen, but predicted below target at exam time. */
  atRisk: number;
  /** Predicted at or above target at exam time. */
  lockedIn: number;
  /** Mean predicted recall if the exam were now. */
  recallNow: number;
  /** Mean predicted recall at exam time with no further study. */
  recallAtExam: number;
  /** Share of cards at or above target at exam time. */
  shareAtTarget: number;
}

export interface ExamPlanDay {
  /** Local date the study day starts on, YYYY-MM-DD. */
  date: string;
  reviews: number;
  newCards: number;
  minutes: number;
  /** Mean predicted exam-time recall once this day's work is done. */
  recallAtExam: number;
}

export interface ExamScorePoint {
  /** Null is "as long as the plan asks for". */
  minutesPerDay: number | null;
  recallAtExam: number;
}

export interface ExamPlan {
  days: ExamPlanDay[];
  /** Projection if the student follows the plan (and its time cap, if set). */
  projected: {
    recallAtExam: number;
    shareAtTarget: number;
    unseen: number;
  };
  /** Whether the projection reaches the target. */
  onTrack: boolean;
  /** Without a cap: typical and heaviest day, in minutes. */
  needed: { typicalMinutes: number; peakMinutes: number; totalMinutes: number };
  /** Exam-time recall bought by different daily time budgets. */
  curve: ExamScorePoint[];
}

export interface ExamTouchpoint {
  /** Cards ready right now, and how long they take. */
  readyNow: number;
  minutesNow: number;
  /**
   * When the next worthwhile session opens: `now` if enough is ready already,
   * a later time otherwise, null when nothing more is needed before the exam.
   */
  nextAt: Date | null;
  /** Cards expected to be ready at `nextAt`. */
  nextCount: number;
}

/**
 * Every tunable in the exam policy. Defaults were chosen by the simulation
 * bake-off in `test/exam-bakeoff.test.ts`; change them there first.
 */
export interface ExamPolicy {
  /** Recall a card must fade to before it is strengthened, far from the exam. */
  gateFloor: number;
  /** Days out at which that gate starts rising toward the target. */
  gateRampDays: number;
  /** Length of the final stretch in which everything below target is fair game. */
  lockInHours: number;
  /** In lock-in, the least time between reviews of one card, as a share of the time left. */
  minGapRatio: number;
  minGapMinutes: number;
  /**
   * Successful recalls a new card needs on its first day, when few sessions
   * remain. 1 turns first-day repeats off, which is the default: in the
   * bake-off they cost 18 to 38% more time for under half a point of recall.
   */
  criterionNear: number;
  /** The same, when at least `criterionNearDays` study days remain. */
  criterionFar: number;
  criterionNearDays: number;
  /** Minutes before a first-day repeat, after the first and later passes. */
  repeatLagMinutes: readonly number[];
  /** Study days before the exam kept free of new cards, for relearning. */
  introReserveDays: number;
  /** Reviews a new card costs on its first day (some need a second look), for triage. */
  newCardCostFactor: number;
}
