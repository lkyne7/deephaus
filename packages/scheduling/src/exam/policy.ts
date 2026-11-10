import type { ExamPolicy } from "./types";

export const DEFAULT_SECONDS_PER_REVIEW = 20;

export const DEFAULT_EXAM_POLICY: ExamPolicy = {
  gateFloor: 0.7,
  gateRampDays: 7,
  lockInHours: 24,
  minGapRatio: 0.3,
  minGapMinutes: 10,
  criterionNear: 1,
  criterionFar: 1,
  criterionNearDays: 3,
  repeatLagMinutes: [3, 10],
  introReserveDays: 3,
  newCardCostFactor: 1.25,
};

export function resolvePolicy(overrides?: Partial<ExamPolicy>): ExamPolicy {
  return overrides ? { ...DEFAULT_EXAM_POLICY, ...overrides } : DEFAULT_EXAM_POLICY;
}

/**
 * How first ratings and passing ratings fall out for a typical student. Used
 * to value a card the student has not seen and to simulate plans.
 */
export const FIRST_RATING_PROB = [0.24, 0.094, 0.495, 0.171] as const;
/** P(hard, good, easy) given the card was recalled. */
export const PASS_RATING_PROB = [0.224, 0.631, 0.145] as const;
