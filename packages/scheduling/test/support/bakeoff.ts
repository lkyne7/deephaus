import type { CardReviewRow, FsrsGrade } from "../../src/fsrs";
import { memoryEngine, type Memory } from "../../src/memory";
import { defaultSessions } from "../../src/exam/plan";
import {
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  clonePlannerState,
  createPlannerState,
  newCardAllowance,
  reviewsDoneToday,
  type PlannerState,
  type PlannerUnit,
} from "../../src/exam/planner";
import { FIRST_RATING_PROB, PASS_RATING_PROB } from "../../src/exam/policy";
import {
  examSimulationPolicy,
  seededRandom,
  simulateToExam,
  type SimulationPolicy,
} from "../../src/exam/simulate";
import type { ExamPolicy, ExamUnit } from "../../src/exam/types";

/** A Monday afternoon, UTC, so study days and weekdays are easy to reason about. */
export const NOW = new Date("2026-11-09T14:00:00.000Z");
export const SECONDS_PER_REVIEW = 20;

export function reviewRow(memory: Memory, overrides: Partial<CardReviewRow> = {}): CardReviewRow {
  return {
    due: new Date(memory.lastReviewMs + DAY_MS).toISOString(),
    stability: memory.stability,
    stability_fast: memory.model === 7 ? memory.stabilityFast : null,
    difficulty: memory.difficulty,
    elapsed_days: 0,
    scheduled_days: 1,
    reps: 3,
    lapses: 0,
    state: 2,
    last_review: new Date(memory.lastReviewMs).toISOString(),
    learning_steps: 0,
    fsrs_version: memory.model,
    ...overrides,
  };
}

function sampleFirst(random: () => number): FsrsGrade {
  const roll = random();
  let acc = 0;
  for (let index = 0; index < FIRST_RATING_PROB.length; index++) {
    acc += FIRST_RATING_PROB[index]!;
    if (roll < acc) return (index + 1) as FsrsGrade;
  }
  return 3;
}

function samplePass(random: () => number): FsrsGrade {
  const total = PASS_RATING_PROB[0] + PASS_RATING_PROB[1] + PASS_RATING_PROB[2];
  const roll = random() * total;
  if (roll < PASS_RATING_PROB[0]) return 2;
  if (roll < PASS_RATING_PROB[0] + PASS_RATING_PROB[1]) return 3;
  return 4;
}

/**
 * A card someone has been studying normally: met some days ago, then reviewed
 * whenever plain FSRS at 90% said it was due, with realistic answers.
 */
export function studiedMemory(random: () => number, nowMs: number): Memory {
  const engine = memoryEngine();
  let at = nowMs - (3 + random() * 57) * DAY_MS;
  let memory = engine.review(null, at, sampleFirst(random));
  for (let guard = 0; guard < 200; guard++) {
    const interval = Math.max(10 / 1440, engine.intervalDays(memory, 0.9));
    const next = at + interval * DAY_MS;
    if (next > nowMs) break;
    at = next;
    const recalled = random() <= engine.recall(memory, at);
    memory = engine.review(memory, at, recalled ? samplePass(random) : 1);
  }
  return memory;
}

export interface DeckShape {
  unseen: number;
  studied: number;
}

export function buildDeck(shape: DeckShape, seed: number, nowMs = NOW.getTime()): ExamUnit[] {
  const random = seededRandom(seed);
  const units: ExamUnit[] = [];
  for (let index = 0; index < shape.studied; index++) {
    units.push({
      key: `s${index}:0`,
      cardId: `s${index}`,
      projectId: "deck",
      review: reviewRow(studiedMemory(random, nowMs)),
      todayRatings: [],
    });
  }
  for (let index = 0; index < shape.unseen; index++) {
    units.push({
      key: `n${index}:0`,
      cardId: `n${index}`,
      projectId: "deck",
      review: null,
      todayRatings: [],
    });
  }
  return units;
}

function stepsDue(state: PlannerState, nowMs: number): PlannerUnit[] {
  return state.units
    .filter((unit) => unit.memory && unit.stepDueMs !== null && unit.stepDueMs <= nowMs)
    .sort((a, b) => (a.stepDueMs ?? 0) - (b.stepDueMs ?? 0));
}

function nextStep(state: PlannerState, nowMs: number): number | null {
  let next: number | null = null;
  for (const unit of state.units) {
    if (unit.stepDueMs !== null && unit.stepDueMs > nowMs && (next === null || unit.stepDueMs < next)) {
      next = unit.stepDueMs;
    }
  }
  return next;
}

function withinCap(state: PlannerState, units: PlannerUnit[], limit: number): PlannerUnit[] {
  const remaining =
    state.capReviewsPerDay === null
      ? Number.POSITIVE_INFINITY
      : Math.max(0, state.capReviewsPerDay - reviewsDoneToday(state));
  return units.slice(0, Math.min(limit, remaining));
}

/**
 * Plain FSRS with the exam target as desired retention: a card is shown when
 * its recall has fallen to the target, whatever the exam date. New cards use
 * the exam policy's pacing so the comparison is about review timing only.
 */
export const plainFsrsPolicy: SimulationPolicy = {
  next(state, nowMs, limit) {
    const steps = stepsDue(state, nowMs);
    const stepKeys = new Set(steps.map((unit) => unit.key));
    const due = state.units
      .filter(
        (unit) =>
          unit.memory &&
          !stepKeys.has(unit.key) &&
          unit.stepDueMs === null &&
          unit.engine.recall(unit.memory, nowMs) <= state.target,
      )
      .sort((a, b) => a.engine.recall(a.memory, nowMs) - b.engine.recall(b.memory, nowMs));
    const fresh = state.units
      .filter((unit) => !unit.memory)
      .slice(0, newCardAllowance(state, nowMs));
    return {
      units: withinCap(state, [...steps, ...due, ...fresh], limit),
      nextReadyAtMs: nextStep(state, nowMs),
    };
  },
};

/**
 * The cram policy this replaces: due cards, then unseen cards, then any card
 * predicted below target at the exam, pulled forward once per day.
 */
export const oldCramPolicy: SimulationPolicy = {
  next(state, nowMs, limit) {
    const steps = stepsDue(state, nowMs);
    const taken = new Set(steps.map((unit) => unit.key));
    const due: PlannerUnit[] = [];
    const risky: PlannerUnit[] = [];
    for (const unit of state.units) {
      if (!unit.memory || taken.has(unit.key) || unit.stepDueMs !== null) continue;
      if (unit.engine.recall(unit.memory, nowMs) <= state.target) due.push(unit);
      else if (unit.ratingsToday.length === 0 && unit.recallAtExam < state.target) risky.push(unit);
    }
    risky.sort((a, b) => a.recallAtExam - b.recallAtExam);
    const fresh = state.units.filter((unit) => !unit.memory);
    return {
      units: withinCap(state, [...steps, ...due, ...fresh, ...risky], limit),
      nextReadyAtMs: nextStep(state, nowMs),
    };
  },
};

export interface Scenario {
  name: string;
  examAt: Date;
  deck: DeckShape;
  capMinutes: number | null;
  target: number;
}

export interface Outcome {
  recallAtExam: number;
  shareAtTarget: number;
  minutes: number;
  unseen: number;
}

export function runScenario(
  scenario: Scenario,
  policy: SimulationPolicy,
  options: { seeds?: number[]; examPolicy?: Partial<ExamPolicy> } = {},
): Outcome {
  const seeds = options.seeds ?? [11, 23, 47];
  const totals: Outcome = { recallAtExam: 0, shareAtTarget: 0, minutes: 0, unseen: 0 };
  for (const seed of seeds) {
    const base = createPlannerState(
      buildDeck(scenario.deck, seed),
      {
        examAt: scenario.examAt,
        targetRecall: scenario.target,
        dailyMinutesCap: scenario.capMinutes,
      },
      {
        now: NOW,
        timezone: "UTC",
        dayStartHour: 4,
        secondsPerReview: SECONDS_PER_REVIEW,
        policy: options.examPolicy,
      },
    );
    const state = clonePlannerState(base);
    const result = simulateToExam(state, {
      nowMs: NOW.getTime(),
      random: seededRandom(seed * 101),
      policy,
      sessions: defaultSessions(state, NOW.getTime()),
    });
    totals.recallAtExam += result.recallAtExam;
    totals.shareAtTarget += result.shareAtTarget;
    totals.minutes += (result.reviews * SECONDS_PER_REVIEW) / 60;
    totals.unseen += result.unseen;
  }
  return {
    recallAtExam: totals.recallAtExam / seeds.length,
    shareAtTarget: totals.shareAtTarget / seeds.length,
    minutes: totals.minutes / seeds.length,
    unseen: totals.unseen / seeds.length,
  };
}

export const POLICIES: Record<string, SimulationPolicy> = {
  "plain FSRS": plainFsrsPolicy,
  "old cram": oldCramPolicy,
  exam: examSimulationPolicy,
};

export function horizonScenarios(deck: DeckShape, capMinutes: number | null): Scenario[] {
  const at = (iso: string) => new Date(iso);
  return [
    { name: "6 hours", examAt: new Date(NOW.getTime() + 6 * HOUR_MS) },
    { name: "2 days", examAt: at("2026-11-11T09:00:00.000Z") },
    { name: "7 days", examAt: at("2026-11-16T09:00:00.000Z") },
    { name: "21 days", examAt: at("2026-11-30T09:00:00.000Z") },
    { name: "56 days", examAt: at("2027-01-04T09:00:00.000Z") },
  ].map((horizon) => ({ ...horizon, deck, capMinutes, target: 0.9 }));
}

export { MINUTE_MS };
