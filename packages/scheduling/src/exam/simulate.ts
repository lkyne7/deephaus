import { Rating, type FsrsGrade } from "../fsrs.js";
import { FIRST_RATING_PROB, PASS_RATING_PROB } from "./policy.js";
import {
  MINUTE_MS,
  applyReview,
  buildBatch,
  nextStudyDayStartMs,
  startNewStudyDay,
  studyDayStartMs,
  type PlannerState,
  type PlannerUnit,
} from "./planner.js";

/** Deterministic 32-bit RNG (mulberry32), so a forecast repeats for the same inputs. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How a simulated student answers: forgets with probability 1 - recall. */
export function sampleRating(unit: PlannerUnit, atMs: number, random: () => number): FsrsGrade {
  if (!unit.memory) {
    const roll = random();
    let acc = 0;
    for (let index = 0; index < FIRST_RATING_PROB.length; index++) {
      acc += FIRST_RATING_PROB[index] ?? 0;
      if (roll < acc) return (index + 1) as FsrsGrade;
    }
    return Rating.Good as FsrsGrade;
  }
  if (random() > unit.engine.recall(unit.memory, atMs)) return Rating.Again as FsrsGrade;
  const total = PASS_RATING_PROB[0] + PASS_RATING_PROB[1] + PASS_RATING_PROB[2];
  const roll = random() * total;
  if (roll < PASS_RATING_PROB[0]) return Rating.Hard as FsrsGrade;
  if (roll < PASS_RATING_PROB[0] + PASS_RATING_PROB[1]) return Rating.Good as FsrsGrade;
  return Rating.Easy as FsrsGrade;
}

/** Decides what a simulated student is shown. The exam policy is the default. */
export interface SimulationPolicy {
  next(
    state: PlannerState,
    nowMs: number,
    limit: number,
  ): { units: PlannerUnit[]; nextReadyAtMs: number | null };
}

export const examSimulationPolicy: SimulationPolicy = {
  next(state, nowMs, limit) {
    const batch = buildBatch(state, nowMs, { limit });
    return {
      units: batch.entries.map((entry) => entry.unit),
      nextReadyAtMs: batch.nextReadyAtMs,
    };
  },
};

export interface SimulationDay {
  dayStartMs: number;
  reviews: number;
  newCards: number;
  /** Mean predicted exam-time recall at the end of the day. */
  recallAtExam: number;
}

export interface SimulationResult {
  days: SimulationDay[];
  reviews: number;
  recallAtExam: number;
  shareAtTarget: number;
  unseen: number;
}

export interface SimulationOptions {
  nowMs: number;
  random: () => number;
  policy?: SimulationPolicy;
  /** When the student sits down on a given study day. */
  sessions(day: { dayStartMs: number; nextDayStartMs: number; isToday: boolean }): number[];
  /** Cards fetched at a time, as a study screen pages its queue. */
  batchSize?: number;
  /** How long the student will wait in-session for a repeat to come due. */
  learnAheadMs?: number;
}

export function meanRecallAtExam(state: PlannerState): number {
  if (state.units.length === 0) return 0;
  let total = 0;
  for (const unit of state.units) total += unit.recallAtExam;
  return total / state.units.length;
}

/**
 * Play a study plan forward to the exam with a simulated student.
 * Mutates `state`; pass a clone.
 */
export function simulateToExam(state: PlannerState, options: SimulationOptions): SimulationResult {
  const policy = options.policy ?? examSimulationPolicy;
  const batchSize = options.batchSize ?? 30;
  const learnAheadMs = options.learnAheadMs ?? 15 * MINUTE_MS;
  const stepMs = state.secondsPerReview * 1000;
  const days: SimulationDay[] = [];
  let reviews = 0;
  let dayStartMs = studyDayStartMs(state, options.nowMs);
  let clock = options.nowMs;
  let isToday = true;

  while (dayStartMs < state.examMs && days.length < 400) {
    if (!isToday) startNewStudyDay(state);
    const nextDay = nextStudyDayStartMs(state, dayStartMs);
    const sessions = options
      .sessions({ dayStartMs, nextDayStartMs: nextDay, isToday })
      .filter((at) => at >= options.nowMs && at < state.examMs)
      .sort((a, b) => a - b);
    let dayReviews = 0;
    let dayNew = 0;

    for (const sessionStart of sessions) {
      clock = Math.max(clock, sessionStart);
      // A session ends when nothing is ready and nothing will be within the
      // learn-ahead window; the guard only stops a misbehaving policy.
      for (let guard = 0; guard < 10_000 && clock < state.examMs; guard++) {
        const { units, nextReadyAtMs } = policy.next(state, clock, batchSize);
        if (units.length === 0) {
          if (
            nextReadyAtMs !== null &&
            nextReadyAtMs > clock &&
            nextReadyAtMs - clock <= learnAheadMs &&
            nextReadyAtMs < state.examMs
          ) {
            clock = nextReadyAtMs;
            continue;
          }
          break;
        }
        for (const unit of units) {
          if (clock >= state.examMs) break;
          if (!unit.memory) dayNew++;
          applyReview(unit, state, clock, sampleRating(unit, clock, options.random));
          clock += stepMs;
          dayReviews++;
        }
      }
    }

    reviews += dayReviews;
    days.push({
      dayStartMs,
      reviews: dayReviews,
      newCards: dayNew,
      recallAtExam: meanRecallAtExam(state),
    });
    dayStartMs = nextDay;
    isToday = false;
  }

  let atTarget = 0;
  let unseen = 0;
  for (const unit of state.units) {
    if (!unit.memory) unseen++;
    if (unit.recallAtExam >= state.target) atTarget++;
  }
  return {
    days,
    reviews,
    recallAtExam: meanRecallAtExam(state),
    shareAtTarget: state.units.length ? atTarget / state.units.length : 0,
    unseen,
  };
}
