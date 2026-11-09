import {
  normalizeExamId,
  normalizeResponseMs,
  normalizeReviewContext,
  studyNow,
  type ReviewContext,
} from "@deephaus/shared";
import type { AbstractPowerSyncDatabase } from "@powersync/common";
import {
  buildScheduler,
  gradeCramItem,
  type CardReviewRow,
  type CramPlanItemRow,
  type FsrsGrade,
  type FsrsWeights,
  type EasyDaysOptions,
  type IntervalPreview,
  type ReviewFields,
} from "@deephaus/scheduling";
import { getLocalReviewHistories, reviewHistoryKey } from "../queries/history";
import { generateUuid } from "../uuid";

export interface GradeCardInput extends EasyDaysOptions {
  userId: string;
  cardId: string;
  clozeOrd: number;
  rating: FsrsGrade;
  /** Current review state; null when the card/ordinal is new. */
  review: CardReviewRow | null;
  /** Weights for this deck: its preset where it has one, else the user's fit. */
  weights?: FsrsWeights;
  desiredRetention?: number;
  /** Stable mutation UUID, also used as the review_logs primary key. */
  mutationId?: string;
  now?: Date;
  rawNow?: Date;
  /** Where the card was answered; ordinary study when omitted. */
  context?: ReviewContext;
  /** The exam this review counted towards. */
  examId?: string | null;
  /** Time from the card being shown to the grade, in ms. */
  responseMs?: number | null;
}

export interface GradeCardResult {
  reviewId: string;
  logId: string;
  next: ReviewFields;
  intervals: IntervalPreview;
  /** Snapshot for undo. Null when the item was new before this grade. */
  previousReview: CardReviewRow | null;
}

/**
 * Grade a card entirely locally: run FSRS, upsert card_reviews, append
 * review_logs. PowerSync's upload queue pushes both writes to Postgres when
 * online — identical net effect to POST /api/cards/[id]/review.
 */
export async function gradeCardLocally(
  db: AbstractPowerSyncDatabase,
  input: GradeCardInput,
): Promise<GradeCardResult> {
  const now = input.now ?? studyNow();
  const nowIso = now.toISOString();
  const rawNowIso = (input.rawNow ?? input.now ?? new Date()).toISOString();
  const scheduler = buildScheduler({
    weights: input.weights,
    requestRetention: input.desiredRetention,
    easyDays: input.easyDays,
    timezone: input.timezone,
    dayStartHour: input.dayStartHour,
  });

  const previousReview = input.review;
  const cardKey = reviewHistoryKey(input.cardId, input.clozeOrd);
  // The card's own history lets the scheduler rebuild its FSRS-7 memory.
  const history =
    (await getLocalReviewHistories(db, [input.cardId])).get(cardKey) ?? [];
  const result = scheduler.grade({
    cardKey,
    review: previousReview,
    history,
    now,
    rating: input.rating,
  });
  const next = result.next;

  const existing = await db.getOptional<{ id: string; version: number | null }>(
    `SELECT id, version FROM card_reviews
     WHERE card_id = ? AND cloze_ord = ? LIMIT 1`,
    [input.cardId, input.clozeOrd],
  );
  const reviewId = existing?.id ?? generateUuid();
  const logId = input.mutationId ?? generateUuid();
  const baseVersion = Number(existing?.version ?? 0);

  await db.writeTransaction(async (tx) => {
    if (existing) {
      await tx.execute(
        `UPDATE card_reviews SET
           due = ?, stability = ?, difficulty = ?, elapsed_days = ?,
           scheduled_days = ?, learning_steps = ?, reps = ?, lapses = ?,
           state = ?, last_review = ?, stability_fast = ?, fsrs_version = ?,
           version = version + 1, updated_at = ?
         WHERE id = ?`,
        [
          next.due,
          next.stability,
          next.difficulty,
          next.elapsed_days,
          next.scheduled_days,
          next.learning_steps,
          next.reps,
          next.lapses,
          next.state,
          next.last_review,
          next.stability_fast,
          next.fsrs_version,
          nowIso,
          reviewId,
        ],
      );
    } else {
      await tx.execute(
        `INSERT INTO card_reviews (
           id, card_id, user_id, cloze_ord, due, stability, difficulty,
           elapsed_days, scheduled_days, learning_steps, reps, lapses, state,
           last_review, stability_fast, fsrs_version, suspended, version,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)`,
        [
          reviewId,
          input.cardId,
          input.userId,
          input.clozeOrd,
          next.due,
          next.stability,
          next.difficulty,
          next.elapsed_days,
          next.scheduled_days,
          next.learning_steps,
          next.reps,
          next.lapses,
          next.state,
          next.last_review,
          next.stability_fast,
          next.fsrs_version,
          nowIso,
          nowIso,
        ],
      );
    }

    await tx.execute(
      `INSERT INTO review_logs (
         id, card_id, user_id, cloze_ord, rating, state, due, stability,
         difficulty, elapsed_days, last_elapsed_days, scheduled_days, review,
         base_version, created_at, next_state, previous_state, raw_review,
         context, exam_id, response_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        logId,
        input.cardId,
        input.userId,
        input.clozeOrd,
        input.rating,
        result.log.state,
        result.log.due,
        result.log.stability,
        result.log.difficulty,
        result.log.elapsed_days,
        result.log.last_elapsed_days,
        result.log.scheduled_days,
        result.log.review,
        baseVersion,
        nowIso,
        JSON.stringify(next),
        JSON.stringify(previousReview),
        rawNowIso,
        // The server drops values it cannot use; keep the local row the same.
        normalizeReviewContext(input.context),
        normalizeExamId(input.examId),
        normalizeResponseMs(input.responseMs),
      ],
    );
  });

  return {
    reviewId,
    logId,
    next,
    // Match the online route (intervals previewed from the new state at its
    // due time) so button labels agree regardless of routing mode.
    intervals: scheduler.previewIntervals({
      cardKey,
      review: next,
      history: [
        ...history,
        { rating: input.rating, state: result.log.state, review: result.log.review },
      ],
      now: new Date(next.due),
    }),
    previousReview,
  };
}

/** Suspend / unsuspend an ordinal locally (creates the row for new items). */
export async function setCardSuspendedLocally(
  db: AbstractPowerSyncDatabase,
  input: {
    userId: string;
    cardId: string;
    clozeOrd: number;
    suspended: boolean;
  },
): Promise<void> {
  const nowIso = new Date().toISOString();
  const existing = await db.getOptional<{ id: string }>(
    `SELECT id FROM card_reviews WHERE card_id = ? AND cloze_ord = ? LIMIT 1`,
    [input.cardId, input.clozeOrd],
  );
  if (existing) {
    await db.execute(
      `UPDATE card_reviews SET suspended = ?, updated_at = ? WHERE id = ?`,
      [input.suspended ? 1 : 0, nowIso, existing.id],
    );
    return;
  }
  if (!input.suspended) return;
  await db.execute(
    `INSERT INTO card_reviews (
       id, card_id, user_id, cloze_ord, due, stability, difficulty,
       elapsed_days, scheduled_days, learning_steps, reps, lapses, state,
       last_review, suspended, version, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 1, 0, ?, ?)`,
    [
      generateUuid(),
      input.cardId,
      input.userId,
      input.clozeOrd,
      nowIso,
      nowIso,
      nowIso,
    ],
  );
}

export interface GradeCramItemInput {
  userId: string;
  item: CramPlanItemRow;
  rating: FsrsGrade;
  targetRetention: number;
  /** Weights frozen with the plan for this item's deck. */
  weights?: FsrsWeights;
  responseMs?: number;
  mutationId?: string;
  now?: Date;
  rawNow?: Date;
}

export interface GradeCramItemResult {
  logId: string;
  next: ReviewFields;
  intervals: IntervalPreview;
  previousItem: CramPlanItemRow;
}

/**
 * Grade a cram item locally: shared cram transition + item update + log
 * append. Mirrors the record_cram_review RPC (including the version bump).
 */
export async function gradeCramItemLocally(
  db: AbstractPowerSyncDatabase,
  input: GradeCramItemInput,
): Promise<GradeCramItemResult> {
  const now = input.now ?? studyNow();
  const nowIso = now.toISOString();
  const rawNowIso = (input.rawNow ?? input.now ?? new Date()).toISOString();
  const transition = gradeCramItem(
    input.item,
    input.rating,
    now,
    input.targetRetention,
    input.weights,
  );
  const logId = input.mutationId ?? generateUuid();

  const previousState = {
    due: input.item.due,
    stability: input.item.stability,
    difficulty: input.item.difficulty,
    elapsed_days: input.item.elapsed_days,
    scheduled_days: input.item.scheduled_days,
    reps: input.item.reps,
    lapses: input.item.lapses,
    state: input.item.state,
    last_review: input.item.last_review,
    learning_steps: input.item.learning_steps,
    stability_fast: input.item.stability_fast ?? null,
    fsrs_version: input.item.fsrs_version ?? null,
    version: input.item.version,
  };

  await db.writeTransaction(async (tx) => {
    await tx.execute(
      `UPDATE cram_plan_items SET
         due = ?, stability = ?, difficulty = ?, elapsed_days = ?,
         scheduled_days = ?, learning_steps = ?, reps = ?, lapses = ?,
         state = ?, last_review = ?, stability_fast = ?, fsrs_version = ?,
         version = version + 1, updated_at = ?
       WHERE id = ?`,
      [
        transition.next.due,
        transition.next.stability,
        transition.next.difficulty,
        transition.next.elapsed_days,
        transition.next.scheduled_days,
        transition.next.learning_steps,
        transition.next.reps,
        transition.next.lapses,
        transition.next.state,
        transition.next.last_review,
        transition.next.stability_fast,
        transition.next.fsrs_version,
        nowIso,
        input.item.id,
      ],
    );

    await tx.execute(
      `INSERT INTO cram_review_logs (
         id, plan_id, item_id, user_id, card_id, cloze_ord, rating, state, due,
         stability, difficulty, elapsed_days, last_elapsed_days, scheduled_days,
         review, response_ms, previous_state, next_state, created_at, raw_review
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        logId,
        input.item.plan_id,
        input.item.id,
        input.userId,
        input.item.card_id,
        input.item.cloze_ord,
        transition.log.rating,
        transition.log.state,
        transition.log.due,
        transition.log.stability,
        transition.log.difficulty,
        transition.log.elapsed_days,
        transition.log.last_elapsed_days,
        transition.log.scheduled_days,
        transition.log.review,
        input.responseMs ?? null,
        JSON.stringify(previousState),
        JSON.stringify(transition.next),
        nowIso,
        rawNowIso,
      ],
    );
  });

  return {
    logId,
    next: transition.next,
    intervals: transition.intervals,
    previousItem: input.item,
  };
}
