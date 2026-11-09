import {
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  buildBatch,
  clonePlannerState,
  createPlannerState,
  nextStudyDayStartMs,
  startNewStudyDay,
  studyDayStartMs,
} from "./planner";
import type { ExamContext, ExamSpec, ExamTouchpoint, ExamUnit } from "./types";

/** Look this far ahead at most; a reminder further out is recomputed anyway. */
const HORIZON_MS = 10 * DAY_MS;

function gridStepMs(aheadMs: number): number {
  if (aheadMs < 6 * HOUR_MS) return 10 * MINUTE_MS;
  if (aheadMs < 48 * HOUR_MS) return 30 * MINUTE_MS;
  return 2 * HOUR_MS;
}

export interface TouchpointOptions {
  /** Fewest ready cards that make a session worth opening. */
  minBatch?: number;
}

/**
 * When the next study session for this exam is worth doing, assuming no
 * reviews happen in between. Drives "next pass at 4:30 pm" and reminders.
 */
export function nextTouchpoint(
  units: readonly ExamUnit[],
  exam: ExamSpec,
  context: ExamContext,
  options: TouchpointOptions = {},
): ExamTouchpoint {
  const state = clonePlannerState(createPlannerState(units, exam, context));
  const nowMs = context.now.getTime();
  const minutesFor = (count: number) => Math.ceil((count * state.secondsPerReview) / 60);
  const none: ExamTouchpoint = { readyNow: 0, minutesNow: 0, nextAt: null, nextCount: 0 };
  if (nowMs >= state.examMs) return none;

  let open = 0;
  for (const unit of state.units) {
    if (!unit.memory || unit.recallAtExam < state.target) open++;
  }
  const readyNow = buildBatch(state, nowMs, { countOnly: true }).entries.length;
  const result: ExamTouchpoint = {
    readyNow,
    minutesNow: minutesFor(readyNow),
    nextAt: null,
    nextCount: 0,
  };
  if (open === 0) return result;

  const minBatch = options.minBatch ?? Math.min(20, Math.max(5, Math.ceil(open * 0.1)), open);
  if (readyNow >= minBatch) return { ...result, nextAt: context.now, nextCount: readyNow };

  const endMs = Math.min(state.examMs, nowMs + HORIZON_MS);
  let nextDayStart = nextStudyDayStartMs(state, studyDayStartMs(state, nowMs));
  let best: { atMs: number; count: number } | null = null;
  for (let at = nowMs + gridStepMs(0); at < endMs; at += gridStepMs(at - nowMs)) {
    if (at >= nextDayStart) {
      startNewStudyDay(state);
      nextDayStart = nextStudyDayStartMs(state, nextDayStart);
    }
    const count = buildBatch(state, at, { countOnly: true }).entries.length;
    if (count >= minBatch) {
      return { ...result, nextAt: new Date(at), nextCount: count };
    }
    if (count > 0 && (!best || count > best.count)) best = { atMs: at, count };
  }
  // Never enough for a full session: point at the fullest moment instead.
  return best ? { ...result, nextAt: new Date(best.atMs), nextCount: best.count } : result;
}
