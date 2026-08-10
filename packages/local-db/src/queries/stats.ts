import type { AbstractPowerSyncDatabase } from "@powersync/common";
import { startOfStudyDayIso } from "@deephaus/scheduling";
import {
  getLocalDeckSummaries,
  getLocalCardStateBreakdown,
  getLocalStudySettings,
} from "./dashboard";
import { resolveLocalDeckSettings } from "./session";
import { countLocalNewReviewsTodayByDeck } from "./study";

export interface LocalStudyDeckOption {
  id: string;
  title: string;
  due: number;
  new: number;
  waiting: number;
}

/** Local replica of GET /api/study/decks. */
export async function getLocalStudyDeckOptions(
  db: AbstractPowerSyncDatabase,
): Promise<LocalStudyDeckOption[]> {
  const now = new Date();
  const global = await getLocalStudySettings(db);
  const startOfDayIso = startOfStudyDayIso(now, global.day_start_hour, global.timezone);
  const [summaries, newReviewsByDeck] = await Promise.all([
    getLocalDeckSummaries(db, now.toISOString()),
    countLocalNewReviewsTodayByDeck(db, startOfDayIso),
  ]);

  const options: LocalStudyDeckOption[] = [];
  for (const deck of summaries) {
    if (deck.card_count === 0) continue;
    const settings = resolveLocalDeckSettings(deck.settings, global);
    const newToday = newReviewsByDeck.get(deck.id) ?? 0;
    const newSupply = Math.max(0, settings.newCardsPerDay - newToday);
    const newAvailable = Math.min(deck.new_count, newSupply);
    options.push({
      id: deck.id,
      title: deck.deck_name || deck.name,
      due: deck.due_count,
      new: newAvailable,
      waiting: deck.due_count + newAvailable,
    });
  }
  return options;
}

export interface LocalDashboardStats {
  reviewed_today: number;
  cards_learned_today: number;
  retention_pct: number | null;
  streak: number;
  due_now: number;
  new_today_remaining: number;
  total_cards: number;
  state_breakdown: { new: number; learning: number; review: number; relearning: number };
  per_deck: Array<{
    deck_id: string;
    name: string;
    due: number;
    new: number;
    last_reviewed: string | null;
    total: number;
  }>;
  last_optimized_at: string | null;
  fsrs_log_count: number;
}

function toDayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function computeStreak(reviewTimes: string[]): number {
  if (reviewTimes.length === 0) return 0;
  const dayKeys = new Set<string>();
  for (const t of reviewTimes) dayKeys.add(toDayKey(new Date(t)));
  let streak = 0;
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  if (!dayKeys.has(toDayKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!dayKeys.has(toDayKey(cursor))) return 0;
  }
  while (dayKeys.has(toDayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** Local replica of GET /api/stats/dashboard (community flags excluded). */
export async function getLocalDashboardStats(
  db: AbstractPowerSyncDatabase,
): Promise<LocalDashboardStats> {
  const now = new Date();
  const global = await getLocalStudySettings(db);
  const startOfDayIso = startOfStudyDayIso(now, global.day_start_hour, global.timezone);
  const since30d = new Date(now);
  since30d.setDate(since30d.getDate() - 30);
  const since200d = new Date(now);
  since200d.setDate(since200d.getDate() - 200);

  const [summaries, breakdown, aggregates, studyDays, fsrsRow, newReviewsByDeck] =
    await Promise.all([
      getLocalDeckSummaries(db, now.toISOString()),
      getLocalCardStateBreakdown(db),
      db.get<Record<string, number>>(
        `SELECT
           (SELECT COUNT(*) FROM review_logs WHERE review >= ?) AS reviewed_today,
           (SELECT COUNT(*) FROM review_logs WHERE review >= ? AND state = 0) AS learned_today,
           (SELECT COUNT(*) FROM review_logs WHERE review >= ?) AS recent_total,
           (SELECT COUNT(*) FROM review_logs WHERE review >= ? AND rating >= 2) AS recent_passed,
           (SELECT COUNT(*) FROM review_logs) AS log_count`,
        [startOfDayIso, startOfDayIso, since30d.toISOString(), since30d.toISOString()],
      ),
      db.getAll<{ review: string }>(
        `SELECT DISTINCT date(review) || 'T12:00:00.000Z' AS review
         FROM review_logs WHERE review >= ?`,
        [since200d.toISOString()],
      ),
      db.getOptional<{ optimized_at: string | null }>(
        `SELECT optimized_at FROM user_fsrs_params LIMIT 1`,
      ),
      countLocalNewReviewsTodayByDeck(db, startOfDayIso),
    ]);

  const perDeck: LocalDashboardStats["per_deck"] = [];
  let dueNow = 0;
  let newTodayRemaining = 0;
  for (const deck of summaries) {
    const settings = resolveLocalDeckSettings(deck.settings, global);
    const newToday = newReviewsByDeck.get(deck.id) ?? 0;
    const newSupply = Math.max(0, settings.newCardsPerDay - newToday);
    const newAvailable = Math.min(deck.new_count, newSupply);
    dueNow += deck.due_count;
    newTodayRemaining += newAvailable;
    perDeck.push({
      deck_id: deck.id,
      name: deck.deck_name || deck.name,
      due: deck.due_count,
      new: newAvailable,
      last_reviewed: deck.last_review,
      total: deck.card_count,
    });
  }

  const recentTotal = Number(aggregates?.recent_total ?? 0);
  const retentionPct =
    recentTotal > 0 ? Number(aggregates?.recent_passed ?? 0) / recentTotal : null;

  return {
    reviewed_today: Number(aggregates?.reviewed_today ?? 0),
    cards_learned_today: Number(aggregates?.learned_today ?? 0),
    retention_pct: retentionPct,
    streak: computeStreak(studyDays.map((row) => row.review)),
    due_now: dueNow,
    new_today_remaining: newTodayRemaining,
    total_cards: summaries.reduce((sum, deck) => sum + deck.card_count, 0),
    state_breakdown: {
      new: breakdown.new_count,
      learning: breakdown.learning_count,
      review: breakdown.review_count,
      relearning: breakdown.relearning_count,
    },
    per_deck: perDeck,
    last_optimized_at: fsrsRow?.optimized_at ?? null,
    fsrs_log_count: Number(aggregates?.log_count ?? 0),
  };
}

export interface LocalReviewHeatmap {
  year: number;
  counts: Record<string, number>;
  forecast: Record<string, number>;
}

/** Local replica of GET /api/stats/heatmap. */
export async function getLocalReviewHeatmap(
  db: AbstractPowerSyncDatabase,
  year = new Date().getFullYear(),
): Promise<LocalReviewHeatmap> {
  const yearStartIso = new Date(Date.UTC(year, 0, 1)).toISOString();
  const yearEndIso = new Date(Date.UTC(year + 1, 0, 1)).toISOString();
  const nowIso = new Date().toISOString();

  const [countRows, forecastRows] = await Promise.all([
    db.getAll<{ day: string; count: number }>(
      `SELECT date(review) AS day, COUNT(*) AS count
       FROM review_logs
       WHERE review >= ? AND review < ?
       GROUP BY date(review)`,
      [yearStartIso, yearEndIso],
    ),
    db.getAll<{ day: string; count: number }>(
      `SELECT date(due) AS day, COUNT(*) AS count
       FROM card_reviews
       WHERE due > ? AND due < ? AND state != 0 AND suspended = 0
       GROUP BY date(due)`,
      [nowIso, yearEndIso],
    ),
  ]);

  const counts: Record<string, number> = {};
  for (const row of countRows) counts[row.day] = Number(row.count ?? 0);
  const forecast: Record<string, number> = {};
  for (const row of forecastRows) forecast[row.day] = Number(row.count ?? 0);

  return { year, counts, forecast };
}
