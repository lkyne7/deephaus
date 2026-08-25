import type { AbstractPowerSyncDatabase } from "@powersync/common";
import {
  buildScheduler,
  cardToRowFields,
  emptyCard,
  gradeCramItem,
  previewIntervals,
  resolveDeckParams,
  rowToCard,
  type CardReviewRow,
  type CramPlanItemRow,
  type FsrsGrade,
  type IntervalPreview,
} from "@deephaus/scheduling";
import { generateUuid } from "../uuid";

export interface GradeCardInput {
  userId: string;
  cardId: string;
  clozeOrd: number;
  rating: FsrsGrade;
  /** Current review state; null when the card/ordinal is new. */
  review: CardReviewRow | null;
  deckParams?: number[];
  userParams?: number[];
  desiredRetention?: number;
  /** Stable mutation UUID, also used as the review_logs primary key. */
  mutationId?: string;
  now?: Date;
}

export interface GradeCardResult {
  reviewId: string;
  logId: string;
  next: ReturnType<typeof cardToRowFields>;
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
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const scheduler = buildScheduler({
    w: resolveDeckParams(input.deckParams, input.userParams),
    requestRetention: input.desiredRetention,
  });

  const previousReview = input.review;
  const fsrsCard = previousReview ? rowToCard(previousReview) : emptyCard(now);
  const previousState = previousReview?.state ?? 0;
  const result = scheduler.next(fsrsCard, now, input.rating);
  const next = cardToRowFields(result.card);

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
           state = ?, last_review = ?, version = version + 1, updated_at = ?
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
          nowIso,
          reviewId,
        ],
      );
    } else {
      await tx.execute(
        `INSERT INTO card_reviews (
           id, card_id, user_id, cloze_ord, due, stability, difficulty,
           elapsed_days, scheduled_days, learning_steps, reps, lapses, state,
           last_review, suspended, version, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)`,
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
          nowIso,
          nowIso,
        ],
      );
    }

    await tx.execute(
      `INSERT INTO review_logs (
         id, card_id, user_id, cloze_ord, rating, state, due, stability,
         difficulty, elapsed_days, last_elapsed_days, scheduled_days, review,
         base_version, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        logId,
        input.cardId,
        input.userId,
        input.clozeOrd,
        input.rating,
        previousState,
        result.log.due.toISOString(),
        result.log.stability,
        result.log.difficulty,
        result.log.elapsed_days,
        result.log.last_elapsed_days,
        result.log.scheduled_days,
        result.log.review.toISOString(),
        baseVersion,
        nowIso,
      ],
    );
  });

  return {
    reviewId,
    logId,
    next,
    intervals: previewIntervals(scheduler, result.card, now),
    previousReview,
  };
}

export interface RestoreReviewInput {
  reviewId: string;
  logId: string;
  /** Review state before the grade; null if the item was new. */
  previousReview: CardReviewRow | null;
}

/** Undo a local grade: restore the prior review state and drop the log row. */
export async function restoreReviewLocally(
  db: AbstractPowerSyncDatabase,
  input: RestoreReviewInput,
): Promise<void> {
  const nowIso = new Date().toISOString();
  await db.writeTransaction(async (tx) => {
    await tx.execute(`DELETE FROM review_logs WHERE id = ?`, [input.logId]);
    if (input.previousReview) {
      const prev = input.previousReview;
      await tx.execute(
        `UPDATE card_reviews SET
           due = ?, stability = ?, difficulty = ?, elapsed_days = ?,
           scheduled_days = ?, learning_steps = ?, reps = ?, lapses = ?,
           state = ?, last_review = ?, updated_at = ?
         WHERE id = ?`,
        [
          prev.due,
          prev.stability,
          prev.difficulty,
          prev.elapsed_days,
          prev.scheduled_days,
          prev.learning_steps,
          prev.reps,
          prev.lapses,
          prev.state,
          prev.last_review,
          nowIso,
          input.reviewId,
        ],
      );
    } else {
      // The grade created the row (item was new); undo removes it entirely.
      await tx.execute(`DELETE FROM card_reviews WHERE id = ?`, [input.reviewId]);
    }
  });
}

/** Suspend / unsuspend an ordinal locally (creates the row for new items). */
export async function setCardSuspendedLocally(
  db: AbstractPowerSyncDatabase,
  input: { userId: string; cardId: string; clozeOrd: number; suspended: boolean },
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
    [generateUuid(), input.cardId, input.userId, input.clozeOrd, nowIso, nowIso, nowIso],
  );
}

export interface GradeCramItemInput {
  userId: string;
  item: CramPlanItemRow;
  rating: FsrsGrade;
  targetRetention: number;
  fsrsParams?: number[];
  responseMs?: number;
  now?: Date;
}

export interface GradeCramItemResult {
  logId: string;
  next: ReturnType<typeof cardToRowFields>;
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
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const transition = gradeCramItem(
    input.item,
    input.rating,
    now,
    input.targetRetention,
    input.fsrsParams,
  );
  const logId = generateUuid();

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
    version: input.item.version,
  };

  await db.writeTransaction(async (tx) => {
    await tx.execute(
      `UPDATE cram_plan_items SET
         due = ?, stability = ?, difficulty = ?, elapsed_days = ?,
         scheduled_days = ?, learning_steps = ?, reps = ?, lapses = ?,
         state = ?, last_review = ?, version = version + 1, updated_at = ?
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
        nowIso,
        input.item.id,
      ],
    );

    await tx.execute(
      `INSERT INTO cram_review_logs (
         id, plan_id, item_id, user_id, card_id, cloze_ord, rating, state, due,
         stability, difficulty, elapsed_days, last_elapsed_days, scheduled_days,
         review, response_ms, previous_state, next_state, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
