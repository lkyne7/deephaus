import {
  parseEasyDays,
  normalEasyDays,
  reviewOrderFromRow,
  type EasyDays,
  type ReviewOrderSettings,
} from "@deephaus/shared";
import type { AbstractPowerSyncDatabase } from "@powersync/common";
import { parseStoredWeights, type FsrsWeights } from "@deephaus/scheduling";
import { DECK_JOIN, HAS_NEW_ORDINAL } from "./study";

export interface LocalDeckSummary {
  id: string;
  name: string;
  deck_name: string;
  created_at: string;
  updated_at: string;
  settings: string | null;
  card_count: number;
  due_count: number;
  new_count: number;
  last_review: string | null;
  /** Counts for today's queue, as get_study_deck_summaries returns them (see deckDayCounts). */
  new_studied_today: number;
  learning_due_count: number;
  review_due_count: number;
  review_due_cards_spaced: number;
  new_cards_spaced: number;
  reviews_today: number;
}

/** Per-deck study summaries — local equivalent of get_study_deck_summaries. */
export async function getLocalDeckSummaries(
  db: AbstractPowerSyncDatabase,
  nowIso: string,
  startOfDayIso: string,
): Promise<LocalDeckSummary[]> {
  type CountRow = {
    project_id: string;
    card_count?: number;
    due_count?: number;
    new_count?: number;
    last_review?: string | null;
    learning_due_count?: number;
    review_due_count?: number;
    review_due_cards_spaced?: number;
    new_cards_spaced?: number;
    new_studied_today?: number;
    reviews_today?: number;
  };

  // Grades since the day began, for spacing siblings (mirrors studied_today).
  const studiedToday = `
    SELECT DISTINCT rl.card_id, rl.cloze_ord FROM review_logs rl
    WHERE COALESCE(rl.undone, 0) = 0 AND rl.review >= ?`;

  const [rows, cardRows, reviewRows, lastReviewRows, dueRows, newSpacedRows, todayRows] =
    await Promise.all([
    db.getAll<Record<string, unknown>>(
      `SELECT id, name, deck_name, created_at, updated_at, settings
       FROM projects
       ORDER BY updated_at DESC`,
    ),
    db.getAll<CountRow>(
      `SELECT s.project_id, COUNT(*) AS card_count
       FROM cards c
       JOIN generation_jobs gj ON gj.id = c.job_id
       JOIN sources s ON s.id = gj.source_id
       GROUP BY s.project_id`,
    ),
    db.getAll<CountRow>(
      `SELECT
         s.project_id,
         SUM(
           CASE
             WHEN cr.suspended = 0 AND cr.due <= ? AND cr.state != 0 THEN 1
             ELSE 0
           END
         ) AS due_count,
         SUM(
           CASE
             WHEN COALESCE(cr.suspended, 0) = 0
              AND (cr.card_id IS NULL OR cr.state = 0) THEN 1
             ELSE 0
           END
         ) AS new_count
       FROM cards c
       JOIN generation_jobs gj ON gj.id = c.job_id
       JOIN sources s ON s.id = gj.source_id
       LEFT JOIN card_reviews cr ON cr.card_id = c.id
       GROUP BY s.project_id`,
      [nowIso],
    ),
    db.getAll<CountRow>(
      `SELECT s.project_id, MAX(rl.review) AS last_review
       FROM review_logs rl
       JOIN cards c ON c.id = rl.card_id
       JOIN generation_jobs gj ON gj.id = c.job_id
       JOIN sources s ON s.id = gj.source_id
       WHERE COALESCE(rl.undone,0)=0 GROUP BY s.project_id`,
    ),
    db.getAll<CountRow>(
      `SELECT
         s.project_id,
         SUM(CASE WHEN cr.state IN (1, 3) THEN 1 ELSE 0 END) AS learning_due_count,
         SUM(CASE WHEN cr.state = 2 THEN 1 ELSE 0 END) AS review_due_count,
         COUNT(DISTINCT CASE
           WHEN cr.state = 2 AND NOT EXISTS (
             SELECT 1 FROM (${studiedToday}) st
             WHERE st.card_id = cr.card_id AND st.cloze_ord != cr.cloze_ord
           ) THEN cr.card_id
         END) AS review_due_cards_spaced
       FROM card_reviews cr
       JOIN cards c ON c.id = cr.card_id
       ${DECK_JOIN}
       WHERE COALESCE(cr.suspended, 0) = 0 AND cr.state != 0 AND cr.due <= ?
       GROUP BY s.project_id`,
      [startOfDayIso, nowIso],
    ),
    db.getAll<CountRow>(
      `SELECT s.project_id, COUNT(*) AS new_cards_spaced
       FROM cards c
       ${DECK_JOIN}
       WHERE ${HAS_NEW_ORDINAL}
         AND NOT EXISTS (SELECT 1 FROM (${studiedToday}) st WHERE st.card_id = c.id)
         AND NOT EXISTS (
           SELECT 1 FROM card_reviews dr
           WHERE dr.card_id = c.id AND COALESCE(dr.suspended, 0) = 0
             AND dr.state = 2 AND dr.due <= ?
         )
       GROUP BY s.project_id`,
      [startOfDayIso, nowIso],
    ),
    db.getAll<CountRow>(
      `SELECT
         s.project_id,
         SUM(CASE WHEN rl.state = 0 THEN 1 ELSE 0 END) AS new_studied_today,
         SUM(CASE WHEN rl.state = 2 THEN 1 ELSE 0 END) AS reviews_today
       FROM review_logs rl
       JOIN cards c ON c.id = rl.card_id
       ${DECK_JOIN}
       WHERE COALESCE(rl.undone, 0) = 0 AND rl.review >= ?
       GROUP BY s.project_id`,
      [startOfDayIso],
    ),
  ]);
  const dueSplit = new Map(dueRows.map((row) => [row.project_id, row]));
  const newSpaced = new Map(newSpacedRows.map((row) => [row.project_id, row]));
  const today = new Map(todayRows.map((row) => [row.project_id, row]));

  const cardCounts = new Map(cardRows.map((row) => [row.project_id, row.card_count]));
  const reviewCounts = new Map(reviewRows.map((row) => [row.project_id, row]));
  const lastReviews = new Map(
    lastReviewRows.map((row) => [row.project_id, row.last_review ?? null]),
  );

  return rows.map((row) => {
    const id = String(row.id);
    const counts = reviewCounts.get(id);
    return {
      id,
      name: String(row.name ?? ""),
      deck_name: String(row.deck_name ?? row.name ?? ""),
      created_at: String(row.created_at ?? ""),
      updated_at: String(row.updated_at ?? ""),
      settings: (row.settings as string | null) ?? null,
      card_count: Number(cardCounts.get(id) ?? 0),
      due_count: Number(counts?.due_count ?? 0),
      new_count: Number(counts?.new_count ?? 0),
      last_review: lastReviews.get(id) ?? null,
      new_studied_today: Number(today.get(id)?.new_studied_today ?? 0),
      learning_due_count: Number(dueSplit.get(id)?.learning_due_count ?? 0),
      review_due_count: Number(dueSplit.get(id)?.review_due_count ?? 0),
      review_due_cards_spaced: Number(dueSplit.get(id)?.review_due_cards_spaced ?? 0),
      new_cards_spaced: Number(newSpaced.get(id)?.new_cards_spaced ?? 0),
      reviews_today: Number(today.get(id)?.reviews_today ?? 0),
    };
  });
}

export interface LocalCardStateBreakdown {
  new_count: number;
  learning_count: number;
  review_count: number;
  relearning_count: number;
}

/** Local equivalent of get_user_card_state_breakdown. */
export async function getLocalCardStateBreakdown(
  db: AbstractPowerSyncDatabase,
): Promise<LocalCardStateBreakdown> {
  // Mirror the server's get_user_card_state_breakdown: classify each card by
  // its primary review row (lowest cloze_ord), so multi-ordinal cloze and
  // occlusion cards count once instead of once per ordinal.
  const row = await db.get<Record<string, number>>(
    `WITH primary_review AS (
       SELECT c.id AS card_id,
              cr.state AS state,
              COALESCE(cr.suspended, 0) AS suspended
       FROM cards c
       LEFT JOIN card_reviews cr ON cr.card_id = c.id
       WHERE cr.id IS NULL
          OR cr.cloze_ord = (
               SELECT MIN(cr2.cloze_ord) FROM card_reviews cr2
               WHERE cr2.card_id = c.id
             )
     )
     SELECT
       SUM(CASE WHEN COALESCE(state, 0) = 0 THEN 1 ELSE 0 END) AS new_count,
       SUM(CASE WHEN state = 1 THEN 1 ELSE 0 END) AS learning_count,
       SUM(CASE WHEN state = 2 THEN 1 ELSE 0 END) AS review_count,
       SUM(CASE WHEN state = 3 THEN 1 ELSE 0 END) AS relearning_count
     FROM primary_review
     WHERE suspended = 0`,
  );
  return {
    new_count: Number(row?.new_count ?? 0),
    learning_count: Number(row?.learning_count ?? 0),
    review_count: Number(row?.review_count ?? 0),
    relearning_count: Number(row?.relearning_count ?? 0),
  };
}

export interface LocalReviewDayCount {
  day: string;
  count: number;
}

/** Heatmap day buckets — local equivalent of review_counts_by_day. */
export async function getLocalReviewCountsByDay(
  db: AbstractPowerSyncDatabase,
  sinceIso: string,
  untilIso: string,
): Promise<LocalReviewDayCount[]> {
  const rows = await db.getAll<Record<string, unknown>>(
    `SELECT date(review) AS day, COUNT(*) AS count
     FROM review_logs
     WHERE COALESCE(undone,0)=0 AND review >= ? AND review < ?
     GROUP BY date(review)
     ORDER BY day`,
    [sinceIso, untilIso],
  );
  return rows.map((row) => ({
    day: String(row.day),
    count: Number(row.count ?? 0),
  }));
}

/** Distinct study days (for streaks) — local equivalent of get_user_study_days. */
export async function getLocalStudyDays(
  db: AbstractPowerSyncDatabase,
  sinceIso: string,
): Promise<string[]> {
  const rows = await db.getAll<{ day: string }>(
    `SELECT DISTINCT date(review) AS day
     FROM review_logs
     WHERE COALESCE(undone,0)=0 AND review >= ?
     ORDER BY day DESC`,
    [sinceIso],
  );
  return rows.map((row) => row.day);
}

export interface LocalTodayStats {
  reviews_today: number;
  new_today: number;
}

export async function getLocalTodayStats(
  db: AbstractPowerSyncDatabase,
  dayStartIso: string,
): Promise<LocalTodayStats> {
  const row = await db.get<Record<string, number>>(
    `SELECT
       (SELECT COUNT(*) FROM review_logs WHERE COALESCE(undone,0)=0 AND review >= ?) AS reviews_today,
       (SELECT COUNT(*) FROM review_logs WHERE COALESCE(undone,0)=0 AND review >= ? AND state = 0) AS new_today`,
    [dayStartIso, dayStartIso],
  );
  return {
    reviews_today: Number(row?.reviews_today ?? 0),
    new_today: Number(row?.new_today ?? 0),
  };
}

export interface LocalStudySettings {
  easy_days?: EasyDays;
  desired_retention: number;
  new_cards_per_day: number;
  day_start_hour: number;
  timezone: string | null;
  /** Review order and limits every deck follows unless it sets its own. */
  review_order: ReviewOrderSettings;
}

const DEFAULT_SETTINGS: LocalStudySettings = {
  easy_days: normalEasyDays(),
  desired_retention: 0.9,
  new_cards_per_day: 10,
  day_start_hour: 4,
  timezone: null,
  review_order: reviewOrderFromRow(null),
};

export async function getLocalStudySettings(
  db: AbstractPowerSyncDatabase,
): Promise<LocalStudySettings> {
  const row = await db.getOptional<Record<string, unknown>>(
    `SELECT desired_retention, new_cards_per_day, day_start_hour, timezone, easy_days,
       space_out_siblings, new_card_position, review_sort_order, max_reviews_per_day
     FROM user_study_settings LIMIT 1`,
  );
  if (!row) return DEFAULT_SETTINGS;
  return {
    easy_days: parseEasyDays(row.easy_days),
    desired_retention: Number(row.desired_retention ?? DEFAULT_SETTINGS.desired_retention),
    new_cards_per_day: Number(row.new_cards_per_day ?? DEFAULT_SETTINGS.new_cards_per_day),
    day_start_hour: Number(row.day_start_hour ?? DEFAULT_SETTINGS.day_start_hour),
    timezone: (row.timezone as string | null) ?? null,
    review_order: reviewOrderFromRow(row),
  };
}

/** The user's fitted weights, per model; a missing model uses its defaults. */
export async function getLocalUserFsrsWeights(
  db: AbstractPowerSyncDatabase,
): Promise<FsrsWeights> {
  const row = await db.getOptional<{ params: string | null; fsrs7_params: string | null }>(
    `SELECT params, fsrs7_params FROM user_fsrs_params LIMIT 1`,
  );
  const parse = (raw: string | null | undefined): unknown => {
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };
  return {
    fsrs6: parseStoredWeights(parse(row?.params)).fsrs6,
    fsrs7: parseStoredWeights(parse(row?.fsrs7_params)).fsrs7,
  };
}
