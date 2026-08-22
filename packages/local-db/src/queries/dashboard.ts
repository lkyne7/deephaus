import type { AbstractPowerSyncDatabase } from "@powersync/common";

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
}

/** Per-deck study summaries — local equivalent of get_study_deck_summaries. */
export async function getLocalDeckSummaries(
  db: AbstractPowerSyncDatabase,
  nowIso: string,
): Promise<LocalDeckSummary[]> {
  type CountRow = {
    project_id: string;
    card_count?: number;
    due_count?: number;
    new_count?: number;
    last_review?: string | null;
  };

  const [rows, cardRows, reviewRows, lastReviewRows] = await Promise.all([
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
       GROUP BY s.project_id`,
    ),
  ]);

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
  const row = await db.get<Record<string, number>>(
    `SELECT
       (SELECT COUNT(*)
          FROM cards c
          LEFT JOIN card_reviews cr ON cr.card_id = c.id
          WHERE cr.card_id IS NULL OR cr.state = 0) AS new_count,
       (SELECT COUNT(*) FROM card_reviews WHERE state = 1 AND suspended = 0) AS learning_count,
       (SELECT COUNT(*) FROM card_reviews WHERE state = 2 AND suspended = 0) AS review_count,
       (SELECT COUNT(*) FROM card_reviews WHERE state = 3 AND suspended = 0) AS relearning_count`,
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
     WHERE review >= ? AND review < ?
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
     WHERE review >= ?
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
       (SELECT COUNT(*) FROM review_logs WHERE review >= ?) AS reviews_today,
       (SELECT COUNT(*) FROM review_logs WHERE review >= ? AND state = 0) AS new_today`,
    [dayStartIso, dayStartIso],
  );
  return {
    reviews_today: Number(row?.reviews_today ?? 0),
    new_today: Number(row?.new_today ?? 0),
  };
}

export interface LocalStudySettings {
  desired_retention: number;
  new_cards_per_day: number;
  day_start_hour: number;
  timezone: string | null;
}

const DEFAULT_SETTINGS: LocalStudySettings = {
  desired_retention: 0.9,
  new_cards_per_day: 10,
  day_start_hour: 4,
  timezone: null,
};

export async function getLocalStudySettings(
  db: AbstractPowerSyncDatabase,
): Promise<LocalStudySettings> {
  const row = await db.getOptional<Record<string, unknown>>(
    `SELECT desired_retention, new_cards_per_day, day_start_hour, timezone
     FROM user_study_settings LIMIT 1`,
  );
  if (!row) return DEFAULT_SETTINGS;
  return {
    desired_retention: Number(row.desired_retention ?? DEFAULT_SETTINGS.desired_retention),
    new_cards_per_day: Number(row.new_cards_per_day ?? DEFAULT_SETTINGS.new_cards_per_day),
    day_start_hour: Number(row.day_start_hour ?? DEFAULT_SETTINGS.day_start_hour),
    timezone: (row.timezone as string | null) ?? null,
  };
}

export async function getLocalUserFsrsParams(
  db: AbstractPowerSyncDatabase,
): Promise<number[] | undefined> {
  const row = await db.getOptional<{ params: string | null }>(
    `SELECT params FROM user_fsrs_params LIMIT 1`,
  );
  if (!row?.params) return undefined;
  try {
    const parsed = JSON.parse(row.params);
    return Array.isArray(parsed) ? (parsed as number[]) : undefined;
  } catch {
    return undefined;
  }
}
