import {
  HOUR_MS,
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
  options: { limit?: number } = {},
): ExamQueue {
  const state = createPlannerState(units, exam, context);
  const nowMs = context.now.getTime();
  const batch = buildBatch(state, nowMs, { limit: options.limit });
  const tomorrowMs = nextStudyDayStartMs(state, studyDayStartMs(state, nowMs));
  return {
    items: batch.entries.map((entry) => ({
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
      batch.nextReadyAtMs !== null && batch.nextReadyAtMs < tomorrowMs
        ? new Date(batch.nextReadyAtMs)
        : null,
    newAllowance: batch.newAllowance,
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
