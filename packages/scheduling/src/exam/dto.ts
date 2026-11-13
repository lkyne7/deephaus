import {
  examStatus,
  normalizeExamSelection,
  normalizeStudyWindows,
  studyQueueKey,
  type ExamDeckBreakdownDto,
  type ExamInsightDto,
  type ExamPlanDto,
  type ExamRow,
  type ExamSnapshotDto,
  type ExamSummaryDto,
} from "@deephaus/shared";

import type { CardReviewRow, FsrsGrade } from "../fsrs.js";
import { planExam, type PlanExamOptions } from "./plan.js";
import { examBreakdown, examReadyByDeck, examSnapshot } from "./queue.js";
import { nextTouchpoint } from "./touchpoints.js";
import type { ExamContext, ExamPlan, ExamSnapshot, ExamSpec, ExamUnit } from "./types.js";

/** One unit as storage returns it (the `exam_units` function, or the replica). */
export interface ExamUnitRow {
  card_id: string;
  cloze_ord: number;
  project_id: string;
  review: CardReviewRow | null;
  /** Grades given since the study day began, oldest first. */
  today: readonly number[];
}

export function toExamUnits(rows: readonly ExamUnitRow[]): ExamUnit[] {
  return rows.map((row) => ({
    key: studyQueueKey(row.card_id, row.cloze_ord),
    cardId: row.card_id,
    projectId: row.project_id,
    review: row.review,
    todayRatings: row.today.filter(
      (rating): rating is FsrsGrade => rating >= 1 && rating <= 4,
    ),
  }));
}

export function examSpecOf(
  exam: Pick<ExamRow, "exam_at" | "target_recall" | "daily_minutes_cap">,
): ExamSpec {
  return {
    examAt: new Date(exam.exam_at),
    targetRecall: exam.target_recall,
    dailyMinutesCap: exam.daily_minutes_cap,
  };
}

export function examSnapshotDto(snapshot: ExamSnapshot): ExamSnapshotDto {
  return {
    stage: snapshot.stage,
    total: snapshot.total,
    unseen: snapshot.unseen,
    at_risk: snapshot.atRisk,
    locked_in: snapshot.lockedIn,
    recall_now: snapshot.recallNow,
    recall_at_exam: snapshot.recallAtExam,
    share_at_target: snapshot.shareAtTarget,
  };
}

export function examPlanDto(plan: ExamPlan): ExamPlanDto {
  return {
    days: plan.days.map((day) => ({
      date: day.date,
      reviews: day.reviews,
      new_cards: day.newCards,
      minutes: day.minutes,
      recall_at_exam: day.recallAtExam,
    })),
    projected: {
      recall_at_exam: plan.projected.recallAtExam,
      share_at_target: plan.projected.shareAtTarget,
      unseen: plan.projected.unseen,
    },
    on_track: plan.onTrack,
    needed: {
      typical_minutes: plan.needed.typicalMinutes,
      peak_minutes: plan.needed.peakMinutes,
      total_minutes: plan.needed.totalMinutes,
    },
    curve: plan.curve.map((point) => ({
      minutes_per_day: point.minutesPerDay,
      recall_at_exam: point.recallAtExam,
    })),
  };
}

/** An exam as lists and headers show it: the row plus where the student stands. */
export function buildExamSummary(
  exam: ExamRow,
  units: readonly ExamUnit[],
  context: ExamContext,
): ExamSummaryDto {
  const spec = examSpecOf(exam);
  const status = examStatus(exam, context.now);
  const touchpoint =
    status === "active"
      ? nextTouchpoint(units, spec, context)
      : { readyNow: 0, minutesNow: 0, nextAt: null };
  return {
    id: exam.id,
    name: exam.name,
    exam_at: exam.exam_at,
    timezone: exam.timezone,
    has_time: Boolean(exam.has_time),
    target_recall: exam.target_recall,
    daily_minutes_cap: exam.daily_minutes_cap,
    selection_spec: normalizeExamSelection(exam.selection_spec),
    study_windows: normalizeStudyWindows(exam.study_windows),
    result_score: exam.result_score,
    status,
    archived_at: exam.archived_at,
    created_at: exam.created_at,
    updated_at: exam.updated_at,
    snapshot: examSnapshotDto(examSnapshot(units, spec, context)),
    ready_now: touchpoint.readyNow,
    minutes_now: touchpoint.minutesNow,
    ready_by_deck:
      status === "active"
        ? examReadyByDeck(units, spec, context).map((deck) => ({
            project_id: deck.projectId,
            new: deck.new,
            due: deck.due,
            early: deck.early,
          }))
        : [],
    next_session_at: touchpoint.nextAt ? touchpoint.nextAt.toISOString() : null,
  };
}

/** Snapshot, forecast and per-deck standing for a selection, saved or not. */
export function buildExamInsight(
  units: readonly ExamUnit[],
  spec: ExamSpec,
  context: ExamContext,
  deckNames: ReadonlyMap<string, string>,
  options: PlanExamOptions = {},
): ExamInsightDto {
  const decks: ExamDeckBreakdownDto[] = examBreakdown(units, spec, context).map((deck) => ({
    project_id: deck.projectId,
    name: deckNames.get(deck.projectId) ?? null,
    total: deck.total,
    unseen: deck.unseen,
    at_risk: deck.atRisk,
    locked_in: deck.lockedIn,
    recall_at_exam: deck.recallAtExam,
  }));
  return {
    snapshot: examSnapshotDto(examSnapshot(units, spec, context)),
    plan: examPlanDto(planExam(units, spec, context, options)),
    decks,
  };
}
