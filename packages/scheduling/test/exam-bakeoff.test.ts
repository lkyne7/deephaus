import { appendFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { POLICIES, horizonScenarios, runScenario, type Outcome } from "./support/bakeoff";

/** Set EXAM_BAKEOFF_OUT to a file path to keep the full comparison table. */
const REPORT_PATH = process.env.EXAM_BAKEOFF_OUT;

function report(title: string, lines: string[]): void {
  if (REPORT_PATH) appendFileSync(REPORT_PATH, `\n${title}\n${lines.join("\n")}\n`);
}

const DECKS = {
  "200 new": { unseen: 200, studied: 0 },
  "100 new + 200 studied": { unseen: 100, studied: 200 },
} as const;

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function row(label: string, outcome: Outcome): string {
  return [
    label.padEnd(42),
    pct(outcome.recallAtExam).padStart(7),
    pct(outcome.shareAtTarget).padStart(8),
    `${outcome.minutes.toFixed(0)} min`.padStart(9),
    `${outcome.unseen.toFixed(0)} unseen`.padStart(11),
  ].join(" ");
}

describe("exam policy bake-off", () => {
  // Uncapped, the question is efficiency: recall reached, and minutes spent.
  it("matches or beats the baselines on exam recall without a time cap", () => {
    const lines: string[] = [];
    const shortfalls: { label: string; gap: number }[] = [];
    for (const [deckName, deck] of Object.entries(DECKS)) {
      for (const scenario of horizonScenarios(deck, null)) {
        const outcomes = Object.fromEntries(
          Object.entries(POLICIES).map(([name, policy]) => [name, runScenario(scenario, policy)]),
        ) as Record<string, Outcome>;
        for (const [name, outcome] of Object.entries(outcomes)) {
          lines.push(row(`${deckName} / ${scenario.name} / ${name}`, outcome));
        }
        const best = Math.max(outcomes["plain FSRS"]!.recallAtExam, outcomes["old cram"]!.recallAtExam);
        shortfalls.push({ label: `${deckName} / ${scenario.name}`, gap: best - outcomes.exam!.recallAtExam });
      }
    }
    report("Uncapped", lines);
    expect(shortfalls.filter((entry) => entry.gap > 0.01)).toEqual([]);
  });

  // With 20 minutes a day every policy spends about the same time, so recall
  // at the exam is the whole comparison.
  it("matches or beats the baselines on exam recall at 20 minutes a day", () => {
    const lines: string[] = [];
    const shortfalls: { label: string; gap: number }[] = [];
    for (const [deckName, deck] of Object.entries(DECKS)) {
      for (const scenario of horizonScenarios(deck, 20)) {
        const outcomes = Object.fromEntries(
          Object.entries(POLICIES).map(([name, policy]) => [name, runScenario(scenario, policy)]),
        ) as Record<string, Outcome>;
        for (const [name, outcome] of Object.entries(outcomes)) {
          lines.push(row(`${deckName} / ${scenario.name} / ${name}`, outcome));
        }
        const best = Math.max(outcomes["plain FSRS"]!.recallAtExam, outcomes["old cram"]!.recallAtExam);
        shortfalls.push({ label: `${deckName} / ${scenario.name}`, gap: best - outcomes.exam!.recallAtExam });
      }
    }
    report("20 minutes a day", lines);
    expect(shortfalls.filter((entry) => entry.gap > 0.01)).toEqual([]);
  });
});
