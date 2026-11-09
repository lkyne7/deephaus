import { LEARN_AHEAD_LIMIT_MINUTES } from "../study-queue";
import {
  HOUR_MS,
  MINUTE_MS,
  buildBatch,
  createPlannerState,
  nextStudyDayStartMs,
  studyDayStartMs,
} from "./planner";
import type {
  ExamContext,
  ExamQueue,
  ExamSnapshot,
  ExamSpec,
  ExamStage,
  ExamUnit,
} from "./types";

/** The cards to study for this exam right now, best first. */
export function examQueue(
  units: readonly ExamUnit[],
  exam: ExamSpec,
  context: ExamContext,
  options: { limit?: number; learnAheadMinutes?: number } = {},
): ExamQueue {
  const state = createPlannerState(units, exam, context);
  const nowMs = context.now.getTime();
  let batch = buildBatch(state, nowMs, { limit: options.limit });
  let entries = batch.entries;
  let learnAhead = false;

  // A card just rated Again is due back in a minute or ten. With nothing else
  // to show, bring those steps forward rather than ending the session on them.
  const window = (options.learnAheadMinutes ?? LEARN_AHEAD_LIMIT_MINUTES) * MINUTE_MS;
  if (
    entries.length === 0 &&
    batch.nextStepAtMs !== null &&
    batch.nextStepAtMs - nowMs <= window
  ) {
    const ahead = buildBatch(state, batch.nextStepAtMs, { limit: options.limit });
    const steps = ahead.entries.filter(
      (entry) => entry.reason === "learning" || entry.reason === "first-learning",
    );
    if (steps.length > 0) {
      batch = { ...batch, skipped: ahead.skipped };
      entries = steps;
      learnAhead = true;
    }
  }

  const tomorrowMs = nextStudyDayStartMs(state, studyDayStartMs(state, nowMs));
  return {
    items: entries.map((entry) => ({
      key: entry.unit.key,
      cardId: entry.unit.cardId,
      projectId: entry.unit.projectId,
      reason: entry.reason,
      recallNow: entry.recallNow,
      recallAtExam: entry.unit.recallAtExam,
      gain: entry.gain,
    })),
    skipped: batch.skipped,
    nextReadyAt:
      !learnAhead && batch.nextReadyAtMs !== null && batch.nextReadyAtMs < tomorrowMs
        ? new Date(batch.nextReadyAtMs)
        : null,
    newAllowance: batch.newAllowance,
    learnAhead,
  };
}

/** Where the student stands for this exam, from the cards' real memory. */
export function examSnapshot(
  units: readonly ExamUnit[],
  exam: ExamSpec,
  context: ExamContext,
): ExamSnapshot {
  const state = createPlannerState(units, exam, context);
  const nowMs = context.now.getTime();
  let unseen = 0;
  let atRisk = 0;
  let lockedIn = 0;
  let recallNow = 0;
  let recallAtExam = 0;
  for (const unit of state.units) {
    if (!unit.memory) {
      unseen++;
      continue;
    }
    recallNow += unit.engine.recall(unit.memory, Math.min(nowMs, state.examMs));
    recallAtExam += unit.recallAtExam;
    if (unit.recallAtExam >= state.target) lockedIn++;
    else atRisk++;
  }
  const total = state.units.length;

  let stage: ExamStage;
  if (nowMs >= state.examMs) stage = "done";
  else if (nowMs >= studyDayStartMs(state, state.examMs)) stage = "exam-day";
  else if (state.examMs - nowMs <= state.policy.lockInHours * HOUR_MS) stage = "lock-in";
  else stage = unseen > 0 ? "learn" : "strengthen";

  return {
    stage,
    total,
    unseen,
    atRisk,
    lockedIn,
    recallNow: total ? recallNow / total : 0,
    recallAtExam: total ? recallAtExam / total : 0,
    shareAtTarget: total ? lockedIn / total : 0,
  };
}

export interface ExamDeckCounts {
  projectId: string;
  total: number;
  unseen: number;
  atRisk: number;
  lockedIn: number;
  /** Mean predicted recall at exam time across the deck's cards. */
  recallAtExam: number;
}

/** The snapshot's counts, deck by deck, weakest deck first. */
export function examBreakdown(
  units: readonly ExamUnit[],
  exam: ExamSpec,
  context: ExamContext,
): ExamDeckCounts[] {
  const state = createPlannerState(units, exam, context);
  const byProject = new Map<string, ExamDeckCounts & { recallSum: number }>();
  for (const unit of state.units) {
    let deck = byProject.get(unit.projectId);
    if (!deck) {
      deck = {
        projectId: unit.projectId,
        total: 0,
        unseen: 0,
        atRisk: 0,
        lockedIn: 0,
        recallAtExam: 0,
        recallSum: 0,
      };
      byProject.set(unit.projectId, deck);
    }
    deck.total++;
    deck.recallSum += unit.recallAtExam;
    if (!unit.memory) deck.unseen++;
    else if (unit.recallAtExam >= state.target) deck.lockedIn++;
    else deck.atRisk++;
  }
  return [...byProject.values()]
    .map(({ recallSum, ...deck }) => ({ ...deck, recallAtExam: recallSum / deck.total }))
    .sort((a, b) => a.recallAtExam - b.recallAtExam);
}
