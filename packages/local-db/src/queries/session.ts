import type { AbstractPowerSyncDatabase } from "@powersync/common";
import {
  DEFAULT_DESIRED_RETENTION,
  DEFAULT_NEW_CARDS_PER_DAY,
  parseGenerationSettings,
} from "@deephaus/shared";
import {
  buildScheduler,
  emptyCard,
  formatInterval,
  gradeToRating,
  previewIntervals,
  resolveDeckParams,
  reviewFieldsFromItem,
  rowToCard,
  startOfStudyDayIso,
  validParamsOrUndefined,
  type CardReviewRow,
  type FsrsGrade,
  type GradeLabel,
  type IntervalPreview,
  type StudyQueueItem,
} from "@deephaus/scheduling";
import {
  getLocalStudySettings,
  getLocalUserFsrsParams,
  type LocalStudySettings,
} from "./dashboard";
import {
  buildLocalStudySessionQueue,
  countLocalNewReviewsToday,
} from "./study";
import { gradeCardLocally } from "../mutations/reviews";
import { generateUuid } from "../uuid";

export interface LocalDeckStudySettings {
  desiredRetention: number;
  newCardsPerDay: number;
  fsrsParams?: number[];
  useGlobalFsrsSettings?: boolean;
}

function parseJson(raw: unknown): unknown {
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Resolve a synced project's JSON settings without another database round-trip. */
export function resolveLocalDeckSettings(
  rawSettings: string | null | undefined,
  global: LocalStudySettings,
): LocalDeckStudySettings {
  let deck: LocalDeckStudySettings;
  try {
    const parsed = parseGenerationSettings(parseJson(rawSettings) ?? {});
    deck = {
      desiredRetention: parsed.desiredRetention,
      newCardsPerDay: parsed.newCardsPerDay,
      fsrsParams: parsed.fsrsParams,
      useGlobalFsrsSettings: parsed.useGlobalFsrsSettings,
    };
  } catch {
    deck = {
      desiredRetention: DEFAULT_DESIRED_RETENTION,
      newCardsPerDay: DEFAULT_NEW_CARDS_PER_DAY,
    };
  }
  if (!deck.useGlobalFsrsSettings) return deck;
  return {
    ...deck,
    desiredRetention: global.desired_retention,
    newCardsPerDay: global.new_cards_per_day,
  };
}

/** Deck settings from the local projects row, resolved against globals. */
export async function getLocalDeckSettings(
  db: AbstractPowerSyncDatabase,
  deckId: string,
  global: LocalStudySettings,
): Promise<LocalDeckStudySettings> {
  const row = await db.getOptional<{ settings: string | null }>(
    `SELECT settings FROM projects WHERE id = ?`,
    [deckId],
  );
  return resolveLocalDeckSettings(row?.settings, global);
}

export interface LocalReviewCardPayload {
  id: string;
  queue_key: string;
  cloze_ord: number | null;
  type: string;
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  occlusion_data: unknown;
  tags: string[];
  state: number;
  due: string;
  reps: number;
  lapses: number;
  intervals: IntervalPreview;
  is_new: boolean;
}

export interface LocalStudyQueuePayload {
  deck: { id: string; name: string };
  cards: LocalReviewCardPayload[];
  day_start_hour: number;
  learn_ahead: boolean;
  counts: {
    due: number;
    new: number;
    learning: number;
    total: number;
    new_today_remaining: number;
    /** New cards that exist but were excluded by today's daily limit. */
    new_held_back: number;
    new_per_day_limit: number;
  };
}

function queueItemToPayload(
  item: StudyQueueItem,
  scheduler: ReturnType<typeof buildScheduler>,
  now: Date,
): LocalReviewCardPayload {
  const row = reviewFieldsFromItem(item);
  const fsrsCard = item.review ? rowToCard(row) : emptyCard(now);
  return {
    id: item.card.id,
    queue_key: item.queue_key,
    cloze_ord: item.cloze_ord,
    type: item.card.type,
    front: item.card.front,
    back: item.card.back,
    cloze_text: item.card.cloze_text,
    extra: item.card.extra,
    occlusion_data: item.card.occlusion_data ?? null,
    tags: item.card.tags ?? [],
    state: fsrsCard.state as number,
    due: fsrsCard.due.toISOString(),
    reps: fsrsCard.reps,
    lapses: fsrsCard.lapses,
    intervals: previewIntervals(scheduler, fsrsCard, now),
    is_new: !item.review || item.review.state === 0,
  };
}

/**
 * Local replica of GET /api/decks/{id}/review — builds the study session from
 * the local SQLite database only.
 */
export async function getLocalStudyQueuePayload(
  db: AbstractPowerSyncDatabase,
  deckId: string,
  options: { limit?: number; newLimit?: number } = {},
): Promise<LocalStudyQueuePayload | null> {
  const limit = Math.max(1, Math.min(200, options.limit ?? 50));
  const now = new Date();
  const nowIso = now.toISOString();

  const project = await db.getOptional<{
    id: string;
    name: string;
    deck_name: string | null;
  }>(`SELECT id, name, deck_name FROM projects WHERE id = ?`, [deckId]);
  if (!project) return null;

  const [global, userParams] = await Promise.all([
    getLocalStudySettings(db),
    getLocalUserFsrsParams(db),
  ]);
  const settings = await getLocalDeckSettings(db, deckId, global);

  const startOfDayIso = startOfStudyDayIso(
    now,
    global.day_start_hour,
    global.timezone,
  );
  const newToday = await countLocalNewReviewsToday(db, deckId, startOfDayIso);
  const requestedNewLimit = Math.max(
    0,
    Math.min(200, options.newLimit ?? settings.newCardsPerDay),
  );
  const newSupply = Math.max(0, requestedNewLimit - newToday);

  const session = await buildLocalStudySessionQueue(
    db,
    deckId,
    nowIso,
    newSupply,
  );
  const queueItems = [...session.due, ...session.newItems].slice(0, limit);

  const scheduler = buildScheduler({
    w: resolveDeckParams(settings.fsrsParams, userParams),
    requestRetention: settings.desiredRetention,
  });

  const payload = queueItems.map((item) =>
    queueItemToPayload(item, scheduler, now),
  );
  const learningDue = session.due.filter(
    (item) =>
      item.review && (item.review.state === 1 || item.review.state === 3),
  ).length;

  return {
    deck: { id: project.id, name: project.deck_name || project.name },
    cards: payload,
    day_start_hour: global.day_start_hour,
    learn_ahead: session.usedLearnAhead,
    counts: {
      due: session.due.length,
      new: session.newTotal,
      learning: learningDue,
      total: payload.length,
      new_today_remaining: Math.min(Math.max(0, newSupply), session.newTotal),
      new_held_back: Math.max(0, session.newTotal - Math.max(0, newSupply)),
      new_per_day_limit: requestedNewLimit,
    },
  };
}

export interface LocalSubmitReviewResult {
  review_id: string;
  previous_state: CardReviewRow | null;
  next_state: Record<string, unknown>;
  log: Record<string, unknown>;
  state: number;
  due: string;
  scheduled_days: number;
  next_interval: string;
  intervals: IntervalPreview;
}

/** Local replica of POST /api/cards/{id}/review. */
export async function submitLocalReview(
  db: AbstractPowerSyncDatabase,
  input: {
    userId: string;
    cardId: string;
    deckId?: string;
    grade: GradeLabel | FsrsGrade;
    clozeOrd?: number;
    mutationId?: string;
    now?: Date;
    rawNow?: Date;
  },
): Promise<LocalSubmitReviewResult> {
  const clozeOrd = input.clozeOrd ?? 0;
  const rating: FsrsGrade =
    typeof input.grade === "string" ? gradeToRating(input.grade) : input.grade;

  // Resolve the deck through the local join when not provided.
  let deckId = input.deckId;
  if (!deckId) {
    const row = await db.getOptional<{ project_id: string }>(
      `SELECT s.project_id AS project_id
       FROM cards c
       JOIN generation_jobs gj ON gj.id = c.job_id
       JOIN sources s ON s.id = gj.source_id
       WHERE c.id = ?`,
      [input.cardId],
    );
    deckId = row?.project_id ?? undefined;
  }

  const [global, userParams] = await Promise.all([
    getLocalStudySettings(db),
    getLocalUserFsrsParams(db),
  ]);
  const settings = deckId
    ? await getLocalDeckSettings(db, deckId, global)
    : {
        desiredRetention: global.desired_retention,
        newCardsPerDay: global.new_cards_per_day,
      };

  const existing = await db.getOptional<Record<string, unknown>>(
    `SELECT due, stability, difficulty, elapsed_days, scheduled_days, reps,
            lapses, state, last_review, learning_steps
     FROM card_reviews WHERE card_id = ? AND cloze_ord = ? LIMIT 1`,
    [input.cardId, clozeOrd],
  );
  const previous: CardReviewRow | null = existing
    ? {
        due: String(existing.due),
        stability: Number(existing.stability ?? 0),
        difficulty: Number(existing.difficulty ?? 0),
        elapsed_days: Number(existing.elapsed_days ?? 0),
        scheduled_days: Number(existing.scheduled_days ?? 0),
        reps: Number(existing.reps ?? 0),
        lapses: Number(existing.lapses ?? 0),
        state: Number(existing.state ?? 0),
        last_review: (existing.last_review as string | null) ?? null,
        learning_steps: Number(existing.learning_steps ?? 0),
      }
    : null;

  const result = await gradeCardLocally(db, {
    userId: input.userId,
    cardId: input.cardId,
    clozeOrd,
    rating,
    review: previous,
    deckParams: (settings as LocalDeckStudySettings).fsrsParams,
    userParams,
    desiredRetention: settings.desiredRetention,
    mutationId: input.mutationId,
    now: input.now,
    rawNow: input.rawNow,
  });

  const logRow = await db.get<Record<string, unknown>>(
    `SELECT rating, state, due, stability, difficulty, elapsed_days,
            last_elapsed_days, scheduled_days, review
     FROM review_logs WHERE id = ?`,
    [result.logId],
  );

  return {
    review_id: result.logId,
    previous_state: previous,
    next_state: result.next as unknown as Record<string, unknown>,
    log: logRow,
    state: result.next.state,
    due: result.next.due,
    scheduled_days: result.next.scheduled_days,
    next_interval: formatInterval(result.next.scheduled_days),
    intervals: result.intervals,
  };
}

export interface LocalRestoreReviewInput {
  userId: string;
  cardId: string;
  clozeOrd: number;
  reviewState: CardReviewRow | null;
  logAction: "delete_latest" | "insert";
  logId?: string;
  log?: Record<string, unknown>;
}

/** Local replica of POST /api/cards/{id}/review/restore (study undo/redo). */
export async function restoreLocalReviewState(
  db: AbstractPowerSyncDatabase,
  input: LocalRestoreReviewInput,
): Promise<Record<string, unknown>> {
  const nowIso = new Date().toISOString();

  if (!input.logId)
    throw new Error("Refresh your study session before undoing a review.");
  await db.writeTransaction(async (tx) => {
    const target = await tx.getOptional<{
      id: string;
      review: string;
      previous_state: string | null;
    }>(
      `SELECT id,review,previous_state FROM review_logs WHERE id=? AND user_id=? AND card_id=? AND cloze_ord=?`,
      [input.logId, input.userId, input.cardId, input.clozeOrd],
    );
    if (!target) throw new Error("Sync this review before undoing it.");
    await tx.execute(`UPDATE review_logs SET undone=? WHERE id=?`, [
      input.logAction === "delete_latest" ? 1 : 0,
      input.logId,
    ]);
    const winner = await tx.getOptional<{ next_state: string | null }>(
      `SELECT next_state FROM review_logs WHERE card_id=? AND user_id=? AND cloze_ord=? AND COALESCE(undone,0)=0 ORDER BY julianday(review) DESC,id DESC LIMIT 1`,
      [input.cardId, input.userId, input.clozeOrd],
    );
    const current = await tx.getOptional<CardReviewRow>(
      `SELECT * FROM card_reviews WHERE card_id=? AND user_id=? AND cloze_ord=?`,
      [input.cardId, input.userId, input.clozeOrd],
    );
    if (
      current?.last_review &&
      Date.parse(current.last_review) > Date.parse(target.review)
    )
      input.reviewState = current;
    else if (winner?.next_state)
      input.reviewState = JSON.parse(winner.next_state) as CardReviewRow;
    else if (!winner) {
      const first = await tx.getOptional<{ previous_state: string | null }>(
        `SELECT previous_state FROM review_logs WHERE card_id=? AND user_id=? AND cloze_ord=? ORDER BY created_at,id LIMIT 1`,
        [input.cardId, input.userId, input.clozeOrd],
      );
      input.reviewState = first?.previous_state
        ? (JSON.parse(first.previous_state) as CardReviewRow | null)
        : null;
    }
    const existing = await tx.getOptional<{
      id: string;
      version: number | null;
    }>(
      `SELECT id, version FROM card_reviews
       WHERE card_id = ? AND cloze_ord = ? LIMIT 1`,
      [input.cardId, input.clozeOrd],
    );
    const baseVersion = Number(existing?.version ?? 0);
    const versionIncrement = 1;

    if (input.reviewState == null) {
      if (existing) {
        await tx.execute(`DELETE FROM card_reviews WHERE id = ?`, [
          existing.id,
        ]);
      }
    } else {
      const state = input.reviewState;
      if (existing) {
        await tx.execute(
          `UPDATE card_reviews SET
             due = ?, stability = ?, difficulty = ?, elapsed_days = ?,
             scheduled_days = ?, learning_steps = ?, reps = ?, lapses = ?,
             state = ?, last_review = ?, version = version + ?, updated_at = ?
           WHERE id = ?`,
          [
            state.due,
            state.stability,
            state.difficulty,
            state.elapsed_days,
            state.scheduled_days,
            state.learning_steps,
            state.reps,
            state.lapses,
            state.state,
            state.last_review,
            versionIncrement,
            nowIso,
            existing.id,
          ],
        );
      } else {
        await tx.execute(
          `INSERT INTO card_reviews (
             id, card_id, user_id, cloze_ord, due, stability, difficulty,
             elapsed_days, scheduled_days, learning_steps, reps, lapses, state,
             last_review, suspended, version, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
          [
            generateUuid(),
            input.cardId,
            input.userId,
            input.clozeOrd,
            state.due,
            state.stability,
            state.difficulty,
            state.elapsed_days,
            state.scheduled_days,
            state.learning_steps,
            state.reps,
            state.lapses,
            state.state,
            state.last_review,
            versionIncrement,
            nowIso,
            nowIso,
          ],
        );
      }
    }

    if (input.logAction === "insert") {
      await tx.execute(`UPDATE review_logs SET undone = 0 WHERE id = ?`, [
        input.logId,
      ]);
    }
  });

  const [global, userParams, deckRow] = await Promise.all([
    getLocalStudySettings(db),
    getLocalUserFsrsParams(db),
    db.getOptional<{ project_id: string }>(
      `SELECT s.project_id AS project_id
       FROM cards c
       JOIN generation_jobs gj ON gj.id = c.job_id
       JOIN sources s ON s.id = gj.source_id
       WHERE c.id = ?`,
      [input.cardId],
    ),
  ]);
  const settings = deckRow
    ? await getLocalDeckSettings(db, deckRow.project_id, global)
    : {
        desiredRetention: global.desired_retention,
        newCardsPerDay: global.new_cards_per_day,
      };
  const scheduler = buildScheduler({
    w: resolveDeckParams(
      (settings as LocalDeckStudySettings).fsrsParams,
      userParams,
    ),
    requestRetention: settings.desiredRetention,
  });
  const restored = input.reviewState
    ? rowToCard(input.reviewState)
    : emptyCard(new Date());

  return {
    state: restored.state as number,
    due: restored.due.toISOString(),
    reps: restored.reps,
    lapses: restored.lapses,
    is_new: input.reviewState == null || input.reviewState.state === 0,
    intervals: previewIntervals(scheduler, restored, new Date()),
  };
}

/** Suspend/unsuspend every ordinal of a card locally. */
export async function suspendLocalCard(
  db: AbstractPowerSyncDatabase,
  input: { userId: string; cardId: string; suspended: boolean },
): Promise<void> {
  const nowIso = new Date().toISOString();
  const rows = await db.getAll<{ id: string }>(
    `SELECT id FROM card_reviews WHERE card_id = ?`,
    [input.cardId],
  );
  if (rows.length > 0) {
    await db.execute(
      `UPDATE card_reviews SET suspended = ?, updated_at = ? WHERE card_id = ?`,
      [input.suspended ? 1 : 0, nowIso, input.cardId],
    );
    return;
  }
  if (!input.suspended) return;
  // No review rows yet: create a suspended state-0 row so the card is excluded
  // from new-card queues (mirrors the server suspend endpoint).
  await db.execute(
    `INSERT INTO card_reviews (
       id, card_id, user_id, cloze_ord, due, stability, difficulty,
       elapsed_days, scheduled_days, learning_steps, reps, lapses, state,
       last_review, suspended, version, created_at, updated_at
     ) VALUES (?, ?, ?, 0, ?, 0, 0, 0, 0, 0, 0, 0, 0, NULL, 1, 0, ?, ?)`,
    [generateUuid(), input.cardId, input.userId, nowIso, nowIso, nowIso],
  );
}
