import { parseEasyDays } from "@deephaus/shared";

import { DEFAULT_DAY_START_HOUR, clampDayStartHour, startOfStudyDay } from "../day-start";
import { studyWeekday } from "../easy-days";
import { Rating, type FsrsGrade } from "../fsrs";
import { memoryEngine, memoryFromReview, type Memory, type MemoryEngine } from "../memory";
import { DEFAULT_SECONDS_PER_REVIEW, FIRST_RATING_PROB, resolvePolicy } from "./policy";
import type { ExamContext, ExamPolicy, ExamReason, ExamSpec, ExamUnit } from "./types";

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

const EASY_DAY_WEIGHT = { minimum: 0.05, reduced: 0.5, normal: 1 } as const;
const GRADES: readonly FsrsGrade[] = [1, 2, 3, 4];

/** A unit as the planner works on it: memory only, cheap to copy and mutate. */
export interface PlannerUnit {
  key: string;
  cardId: string;
  projectId: string;
  /** Position in the caller's list, which is the decks' own card order. */
  order: number;
  engine: MemoryEngine;
  memory: Memory | null;
  reps: number;
  ratingsToday: FsrsGrade[];
  /** False when today's grades are unknown, so the first-day criterion can't be judged. */
  gradesKnown: boolean;
  /** A pending learning or relearning step. */
  stepDueMs: number | null;
  /** Cached: predicted recall at exam time with no further study. */
  recallAtExam: number;
}

export interface PlannerState {
  units: PlannerUnit[];
  examMs: number;
  target: number;
  policy: ExamPolicy;
  timezone: string | null;
  dayStartHour: number;
  /** Monday-first load weight of each weekday (easy days). */
  weekdayWeights: number[];
  secondsPerReview: number;
  capReviewsPerDay: number | null;
}

export function createPlannerState(
  units: readonly ExamUnit[],
  exam: ExamSpec,
  context: ExamContext,
): PlannerState {
  const examMs = exam.examAt.getTime();
  const timezone = context.timezone ?? null;
  const dayStartHour = clampDayStartHour(context.dayStartHour ?? DEFAULT_DAY_START_HOUR);
  const secondsPerReview = Math.max(
    1,
    context.secondsPerReview ?? DEFAULT_SECONDS_PER_REVIEW,
  );
  const todayStartMs = startOfStudyDay(context.now, dayStartHour, timezone).getTime();

  const plannerUnits = units.map((unit, order): PlannerUnit => {
    const engine = memoryEngine(
      context.weightsByProject?.get(unit.projectId) ?? context.defaultWeights,
    );
    const memory = memoryFromReview(unit.review);
    const review = unit.review;
    const reviewedToday = memory !== null && memory.lastReviewMs >= todayStartMs;
    const stepDue =
      memory && review && (review.state === 1 || review.state === 3)
        ? Date.parse(review.due)
        : Number.NaN;
    return {
      key: unit.key,
      cardId: unit.cardId,
      projectId: unit.projectId,
      order,
      engine,
      memory,
      reps: memory ? Math.max(1, review?.reps ?? 1) : 0,
      ratingsToday: unit.todayRatings
        ? [...unit.todayRatings]
        : reviewedToday
          ? [Rating.Good as FsrsGrade]
          : [],
      gradesKnown: unit.todayRatings !== undefined,
      stepDueMs: Number.isFinite(stepDue) ? stepDue : null,
      recallAtExam: engine.recall(memory, examMs),
    };
  });

  const easyDays = parseEasyDays(context.easyDays);
  return {
    units: plannerUnits,
    examMs,
    target: exam.targetRecall,
    policy: resolvePolicy(context.policy),
    timezone,
    dayStartHour,
    weekdayWeights: easyDays.map((level) => EASY_DAY_WEIGHT[level]),
    secondsPerReview,
    capReviewsPerDay:
      exam.dailyMinutesCap == null
        ? null
        : Math.max(1, Math.floor((exam.dailyMinutesCap * 60) / secondsPerReview)),
  };
}

/** A deep-enough copy for a simulation to mutate. */
export function clonePlannerState(state: PlannerState): PlannerState {
  return {
    ...state,
    units: state.units.map((unit) => ({ ...unit, ratingsToday: [...unit.ratingsToday] })),
  };
}

export function studyDayStartMs(state: PlannerState, atMs: number): number {
  return startOfStudyDay(new Date(atMs), state.dayStartHour, state.timezone).getTime();
}

/** Thirty hours on lands inside the next study day even across a clock change. */
export function nextStudyDayStartMs(state: PlannerState, dayStartMs: number): number {
  return studyDayStartMs(state, dayStartMs + 30 * HOUR_MS);
}

function weekdayWeight(state: PlannerState, dayStartMs: number): number {
  const weekday = studyWeekday(
    new Date(dayStartMs + HOUR_MS),
    state.timezone ?? "UTC",
    state.dayStartHour,
  );
  return state.weekdayWeights[weekday] ?? 1;
}

/** Load weights of the study days from the one containing `nowMs` up to the exam. */
function remainingDayWeights(state: PlannerState, nowMs: number): number[] {
  const weights: number[] = [];
  let dayStart = studyDayStartMs(state, nowMs);
  // An exam years away needs no more precision than this.
  while (dayStart < state.examMs && weights.length < 400) {
    weights.push(weekdayWeight(state, dayStart));
    dayStart = nextStudyDayStartMs(state, dayStart);
  }
  return weights;
}

function passesToday(unit: PlannerUnit): number {
  let passes = 0;
  for (const rating of unit.ratingsToday) if (rating >= Rating.Hard) passes++;
  return passes;
}

/** Every review this unit has ever had happened today. */
function introducedToday(unit: PlannerUnit): boolean {
  return unit.ratingsToday.length > 0 && unit.reps <= unit.ratingsToday.length;
}

interface Env {
  nowMs: number;
  lockIn: boolean;
  gate: number;
  criterion: number;
}

export function strengthenGate(state: PlannerState, nowMs: number): number {
  const { policy, target } = state;
  if (target <= policy.gateFloor) return target;
  const daysLeft = (state.examMs - nowMs) / DAY_MS;
  const lockInDays = policy.lockInHours / 24;
  const span = Math.max(0.001, policy.gateRampDays - lockInDays);
  const progress = Math.max(0, Math.min(1, (policy.gateRampDays - daysLeft) / span));
  return policy.gateFloor + (target - policy.gateFloor) * progress;
}

type Verdict =
  | { kind: "ready"; reason: ExamReason }
  | { kind: "wait"; atMs: number; step?: boolean }
  | { kind: "new" }
  | { kind: "idle" };

const IDLE: Verdict = { kind: "idle" };
const NEW: Verdict = { kind: "new" };

function assess(unit: PlannerUnit, state: PlannerState, env: Env): Verdict {
  const { memory } = unit;
  if (!memory) return NEW;
  const { nowMs } = env;
  const { policy, examMs, target } = state;
  const atRisk = unit.recallAtExam < target;
  const firstDay = unit.gradesKnown && introducedToday(unit);

  if (unit.stepDueMs !== null && unit.stepDueMs < examMs && (atRisk || firstDay)) {
    return unit.stepDueMs <= nowMs
      ? { kind: "ready", reason: "learning" }
      : { kind: "wait", atMs: unit.stepDueMs, step: true };
  }

  if (firstDay && unit.ratingsToday[0] !== Rating.Easy) {
    const passes = passesToday(unit);
    if (passes > 0 && passes < env.criterion) {
      const lags = policy.repeatLagMinutes;
      const lag = (lags[Math.min(passes, lags.length) - 1] ?? 0) * MINUTE_MS;
      const readyAt = memory.lastReviewMs + lag;
      return readyAt <= nowMs
        ? { kind: "ready", reason: "first-learning" }
        : { kind: "wait", atMs: readyAt, step: true };
    }
  }

  if (!atRisk) return IDLE;

  if (env.lockIn) {
    // A card may come round again, but only after a gap that shrinks with the
    // time left, so the last hours never collapse into drilling one card.
    const ratio = policy.minGapRatio;
    const readyAt = Math.max(
      memory.lastReviewMs + policy.minGapMinutes * MINUTE_MS,
      (memory.lastReviewMs + ratio * examMs) / (1 + ratio),
    );
    if (readyAt <= nowMs) return { kind: "ready", reason: "lock-in" };
    return readyAt < examMs ? { kind: "wait", atMs: readyAt } : IDLE;
  }

  // Before lock-in a card is pulled forward at most once per study day, which
  // puts a night's sleep between its sessions.
  if (unit.ratingsToday.length > 0) return IDLE;

  return unit.engine.recall(memory, nowMs) <= env.gate
    ? { kind: "ready", reason: "strengthen" }
    : IDLE;
}

/** Expected rise in exam-time recall from reviewing a seen card now. */
function seenGain(unit: PlannerUnit, state: PlannerState, nowMs: number, recallNow: number): number {
  const memory = unit.memory as Memory;
  const pass = unit.engine.recall(
    unit.engine.review(memory, nowMs, Rating.Good as FsrsGrade),
    state.examMs,
  );
  const fail = unit.engine.recall(
    unit.engine.review(memory, nowMs, Rating.Again as FsrsGrade),
    state.examMs,
  );
  return recallNow * pass + (1 - recallNow) * fail - unit.recallAtExam;
}

/** Expected exam-time recall from meeting a new card now. */
function newGain(engine: MemoryEngine, state: PlannerState, nowMs: number): number {
  let gain = 0;
  for (const grade of GRADES) {
    gain +=
      (FIRST_RATING_PROB[grade - 1] ?? 0) *
      engine.recall(engine.review(null, nowMs, grade), state.examMs);
  }
  return gain;
}

/**
 * New cards still to introduce today. They are spread evenly over the days
 * before the reserve, which is kept free for relearning what was introduced.
 * Inside the reserve there is no time left to pace: everything unseen is due.
 */
function pacedNewAllowance(
  policy: ExamPolicy,
  dayWeights: readonly number[],
  unseen: number,
  introduced: number,
): number {
  const introDays = dayWeights.length - policy.introReserveDays;
  if (introDays <= 0) return unseen;
  let introWeight = 0;
  for (let index = 0; index < introDays; index++) introWeight += dayWeights[index] ?? 1;
  const todayShare = introWeight > 0 ? (dayWeights[0] ?? 1) / introWeight : 1;
  const dayQuota = Math.ceil((unseen + introduced) * Math.min(1, todayShare));
  return Math.max(0, dayQuota - introduced);
}

/** The pacing rule on its own, for policies that only borrow it. */
export function newCardAllowance(state: PlannerState, nowMs: number): number {
  let unseen = 0;
  let introduced = 0;
  for (const unit of state.units) {
    if (!unit.memory) unseen++;
    else if (introducedToday(unit)) introduced++;
  }
  if ((state.examMs - nowMs) / HOUR_MS <= state.policy.lockInHours) return unseen;
  return Math.min(
    unseen,
    pacedNewAllowance(state.policy, remainingDayWeights(state, nowMs), unseen, introduced),
  );
}

export interface BatchEntry {
  unit: PlannerUnit;
  reason: ExamReason;
  recallNow: number;
  gain: number;
}

export interface Batch {
  entries: BatchEntry[];
  skipped: number;
  nextReadyAtMs: number | null;
  /** The soonest pending learning step or first-day repeat, if any. */
  nextStepAtMs: number | null;
  newAllowance: number;
}

/** Take turns between decks, keeping each deck's own order. */
function roundRobinByProject(units: PlannerUnit[]): PlannerUnit[] {
  const byProject = new Map<string, PlannerUnit[]>();
  for (const unit of units) {
    const list = byProject.get(unit.projectId);
    if (list) list.push(unit);
    else byProject.set(unit.projectId, [unit]);
  }
  if (byProject.size <= 1) return units;
  const lists = [...byProject.values()];
  const out: PlannerUnit[] = [];
  for (let index = 0; out.length < units.length; index++) {
    for (const list of lists) {
      const unit = list[index];
      if (unit) out.push(unit);
    }
  }
  return out;
}

/** Move siblings of one note apart where another card can go between them. */
function separateSiblings(entries: BatchEntry[]): void {
  for (let index = 1; index < entries.length; index++) {
    if (entries[index]!.unit.cardId !== entries[index - 1]!.unit.cardId) continue;
    for (let swap = index + 1; swap < entries.length; swap++) {
      if (entries[swap]!.unit.cardId !== entries[index]!.unit.cardId) {
        const moved = entries[swap]!;
        entries[swap] = entries[index]!;
        entries[index] = moved;
        break;
      }
    }
  }
}

export interface BatchOptions {
  /** Most cards to return. */
  limit?: number;
  /** Skip valuing and ordering; only membership and counts are needed. */
  countOnly?: boolean;
}

/**
 * The cards worth studying at `nowMs`, best first. This is the whole exam
 * policy: the queue, the forecast and the reminders all call it.
 */
export function buildBatch(state: PlannerState, nowMs: number, options: BatchOptions = {}): Batch {
  const { policy, examMs } = state;
  const empty: Batch = {
    entries: [],
    skipped: 0,
    nextReadyAtMs: null,
    nextStepAtMs: null,
    newAllowance: 0,
  };
  if (nowMs >= examMs) return empty;

  let unseen = 0;
  let introduced = 0;
  let reviewsToday = 0;
  for (const unit of state.units) {
    reviewsToday += unit.ratingsToday.length;
    if (!unit.memory) unseen++;
    else if (introducedToday(unit)) introduced++;
  }

  const dayWeights = remainingDayWeights(state, nowMs);
  const daysLeft = dayWeights.length;
  const hoursLeft = (examMs - nowMs) / HOUR_MS;
  const lockIn = hoursLeft <= policy.lockInHours;
  const env: Env = {
    nowMs,
    lockIn,
    gate: strengthenGate(state, nowMs),
    criterion: daysLeft <= policy.criterionNearDays ? policy.criterionNear : policy.criterionFar,
  };

  const repeats: BatchEntry[] = [];
  const strengthen: BatchEntry[] = [];
  const lockInReady: BatchEntry[] = [];
  const fresh: PlannerUnit[] = [];
  let nextReadyAtMs: number | null = null;
  let nextStepAtMs: number | null = null;

  for (const unit of state.units) {
    const verdict = assess(unit, state, env);
    if (verdict.kind === "idle") continue;
    if (verdict.kind === "new") {
      fresh.push(unit);
      continue;
    }
    if (verdict.kind === "wait") {
      if (nextReadyAtMs === null || verdict.atMs < nextReadyAtMs) nextReadyAtMs = verdict.atMs;
      if (verdict.step && (nextStepAtMs === null || verdict.atMs < nextStepAtMs)) {
        nextStepAtMs = verdict.atMs;
      }
      continue;
    }
    const recallNow = unit.engine.recall(unit.memory, nowMs);
    const entry: BatchEntry = {
      unit,
      reason: verdict.reason,
      recallNow,
      gain: options.countOnly ? 0 : seenGain(unit, state, nowMs, recallNow),
    };
    if (verdict.reason === "learning" || verdict.reason === "first-learning") repeats.push(entry);
    else if (verdict.reason === "strengthen") strengthen.push(entry);
    else lockInReady.push(entry);
  }

  const newAllowance = lockIn
    ? fresh.length
    : Math.min(fresh.length, pacedNewAllowance(policy, dayWeights, unseen, introduced));

  const gainByEngine = new Map<MemoryEngine, number>();
  const toNewEntry = (unit: PlannerUnit): BatchEntry => {
    let gain = 0;
    if (!options.countOnly) {
      const cached = gainByEngine.get(unit.engine);
      gain = cached ?? newGain(unit.engine, state, nowMs);
      if (cached === undefined) gainByEngine.set(unit.engine, gain);
    }
    return { unit, reason: "new", recallNow: 0, gain };
  };
  const newEntries = roundRobinByProject(fresh).slice(0, newAllowance).map(toNewEntry);

  // One ranking for everything that is ready: the expected rise in exam-time
  // recall per review. A new card can need a second look the same day, so its
  // payoff is divided by that before it competes with a quick top-up. When
  // today's time runs out, whatever is cut is what would have paid least.
  let ordered = [...repeats, ...strengthen, ...lockInReady, ...newEntries];
  if (!options.countOnly) {
    const cost = Math.max(1, policy.newCardCostFactor);
    const value = (entry: BatchEntry) => (entry.reason === "new" ? entry.gain / cost : entry.gain);
    ordered = ordered
      .map((entry) => ({ entry, value: value(entry) }))
      // Stable, so equal-valued new cards keep taking turns between decks.
      .sort((a, b) => b.value - a.value)
      .map(({ entry }) => entry);
  }

  const remainingToday =
    state.capReviewsPerDay === null
      ? Number.POSITIVE_INFINITY
      : Math.max(0, state.capReviewsPerDay - reviewsToday);
  const skipped = Math.max(0, ordered.length - remainingToday);
  const entries = ordered.slice(0, Math.min(remainingToday, options.limit ?? ordered.length));
  if (!options.countOnly) separateSiblings(entries);

  return { entries, skipped, nextReadyAtMs, nextStepAtMs, newAllowance };
}

/** Apply one graded review to a planner unit, as grading the real card would. */
export function applyReview(
  unit: PlannerUnit,
  state: PlannerState,
  atMs: number,
  rating: FsrsGrade,
): void {
  const wasNew = unit.memory === null;
  unit.memory = unit.engine.review(unit.memory, atMs, rating);
  unit.reps += 1;
  unit.ratingsToday.push(rating);
  unit.stepDueMs = rating === Rating.Again ? atMs + (wasNew ? 1 : 10) * MINUTE_MS : null;
  unit.recallAtExam = unit.engine.recall(unit.memory, state.examMs);
}

/** A new study day: yesterday's grades no longer hold a card back. */
export function startNewStudyDay(state: PlannerState): void {
  for (const unit of state.units) {
    unit.ratingsToday = [];
    unit.gradesKnown = true;
  }
}

export function reviewsDoneToday(state: PlannerState): number {
  let total = 0;
  for (const unit of state.units) total += unit.ratingsToday.length;
  return total;
}
