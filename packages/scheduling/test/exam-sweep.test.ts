import { appendFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { ExamPolicy } from "../src/exam/types";
import { POLICIES, horizonScenarios, runScenario } from "./support/bakeoff";

/**
 * One-at-a-time sweeps of the exam policy's constants. Slow, so it only runs
 * when asked: EXAM_SWEEP_OUT=<file> pnpm --filter @deephaus/scheduling sweep
 */
const OUT = process.env.EXAM_SWEEP_OUT;

const DECKS = [
  { unseen: 200, studied: 0 },
  { unseen: 100, studied: 200 },
];

const SWEEPS: Record<string, Partial<ExamPolicy>[]> = {
  gateFloor: [0.6, 0.65, 0.7, 0.75, 0.8, 0.9].map((gateFloor) => ({ gateFloor })),
  gateRampDays: [4, 7, 14].map((gateRampDays) => ({ gateRampDays })),
  lockInHours: [12, 24, 36].map((lockInHours) => ({ lockInHours })),
  minGapRatio: [0.15, 0.3, 0.4].map((minGapRatio) => ({ minGapRatio })),
  introReserveDays: [1, 2, 3, 5].map((introReserveDays) => ({ introReserveDays })),
  criterion: [1, 2, 3].map((count) => ({ criterionNear: count, criterionFar: count })),
};

function summarise(examPolicy: Partial<ExamPolicy>) {
  let uncappedRecall = 0;
  let uncappedMinutes = 0;
  let cappedRecall = 0;
  let count = 0;
  for (const deck of DECKS) {
    for (const scenario of horizonScenarios(deck, null)) {
      const outcome = runScenario(scenario, POLICIES.exam!, { examPolicy });
      uncappedRecall += outcome.recallAtExam;
      uncappedMinutes += outcome.minutes;
      count++;
    }
    for (const scenario of horizonScenarios(deck, 20)) {
      cappedRecall += runScenario(scenario, POLICIES.exam!, { examPolicy }).recallAtExam;
    }
  }
  return {
    uncappedRecall: uncappedRecall / count,
    uncappedMinutes,
    cappedRecall: cappedRecall / count,
  };
}

/** EXAM_SWEEP_ONLY=gateFloor,criterion limits the run to those sweeps. */
const ONLY = process.env.EXAM_SWEEP_ONLY?.split(",");

describe.skipIf(!OUT)("exam policy sweep", () => {
  for (const [name, variants] of Object.entries(SWEEPS)) {
    if (ONLY && !ONLY.includes(name)) continue;
    it(`sweeps ${name}`, () => {
      const lines = variants.map((variant) => {
        const result = summarise(variant);
        return [
          JSON.stringify(variant).padEnd(44),
          `uncapped ${(result.uncappedRecall * 100).toFixed(2)}%`,
          `in ${result.uncappedMinutes.toFixed(0)} min`,
          `| 20 min/day ${(result.cappedRecall * 100).toFixed(2)}%`,
        ].join("  ");
      });
      appendFileSync(OUT!, `\n${name}\n${lines.join("\n")}\n`);
      expect(lines.length).toBe(variants.length);
    });
  }
});
