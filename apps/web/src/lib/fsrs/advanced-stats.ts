import type { SupabaseClient } from "@supabase/supabase-js";
import { toIsoDateKey, toDayKey } from "@/lib/fsrs/date-utils";

/**
 * Advanced statistics powering the dashboard's "Advanced statistics" modal.
 *
 * Everything here is computed on-demand (not on every dashboard paint), so we
 * can afford a few more queries than `getDashboardStats`. Two scopes are
 * supported: the whole account (`deckId === null`) or a single deck.
 *
 * "Mature" follows the Anki convention: a review-state card whose last
 * scheduled interval is at least 21 days.
 */
const MATURE_INTERVAL_DAYS = 21;
const RATING_WINDOW_DAYS = 90;
const RETENTION_WINDOW_DAYS = 30;
const REVIEWS_SERIES_DAYS = 30;
const FORECAST_DAYS = 14;
const STREAK_WINDOW_DAYS = 200;

export class DeckNotFoundError extends Error {
  constructor() {
    super("Deck not found");
    this.name = "DeckNotFoundError";
  }
}

export interface RatingDistribution {
  again: number;
  hard: number;
  good: number;
  easy: number;
}

export interface MaturityBreakdown {
  new: number;
  learning: number;
  young: number;
  mature: number;
  suspended: number;
}

export interface StateBreakdown {
  new: number;
  learning: number;
  review: number;
  relearning: number;
}

export interface DayCount {
  date: string;
  count: number;
}

export interface DeckStatRow {
  deck_id: string;
  name: string;
  total_cards: number;
  due: number;
  mature: number;
  reviews_90d: number;
  retention_90d: number | null;
}

export interface AdvancedStats {
  scope: { deck_id: string | null; deck_name: string | null };
  total_cards: number;
  total_reviews: number;
  reviews_30d: number;
  retention_30d: number | null;
  retention_window_days: number;
  rating_window_days: number;
  mature_cards: number;
  avg_stability: number | null;
  avg_difficulty: number | null;
  streak: number;
  rating_distribution: RatingDistribution;
  maturity: MaturityBreakdown;
  state_breakdown: StateBreakdown;
  reviews_per_day: DayCount[];
  due_forecast: DayCount[];
  per_deck: DeckStatRow[];
}

interface ReviewRow {
  card_id: string;
  due: string;
  state: number;
  stability: number;
  difficulty: number;
  scheduled_days: number;
  suspended: boolean | null;
}

interface LogRow {
  review: string;
  rating: number;
  card_id: string;
}

interface DeckRow {
  id: string;
  name: string;
  deck_name: string | null;
}

type CardJoinRow = {
  id: string;
  generation_jobs:
    | { sources: { project_id: string } | { project_id: string }[] }
    | Array<{ sources: { project_id: string } | { project_id: string }[] }>;
};

function projectIdOf(row: CardJoinRow): string {
  const gj = Array.isArray(row.generation_jobs) ? row.generation_jobs[0] : row.generation_jobs;
  const src = Array.isArray(gj.sources) ? gj.sources[0] : gj.sources;
  return src.project_id;
}

function startOfDay(offsetDays = 0): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d;
}

function emptyStats(deckId: string | null, deckName: string | null): AdvancedStats {
  return {
    scope: { deck_id: deckId, deck_name: deckName },
    total_cards: 0,
    total_reviews: 0,
    reviews_30d: 0,
    retention_30d: null,
    retention_window_days: RETENTION_WINDOW_DAYS,
    rating_window_days: RATING_WINDOW_DAYS,
    mature_cards: 0,
    avg_stability: null,
    avg_difficulty: null,
    streak: 0,
    rating_distribution: { again: 0, hard: 0, good: 0, easy: 0 },
    maturity: { new: 0, learning: 0, young: 0, mature: 0, suspended: 0 },
    state_breakdown: { new: 0, learning: 0, review: 0, relearning: 0 },
    reviews_per_day: [],
    due_forecast: [],
    per_deck: [],
  };
}

async function fetchLogsSince(
  supabase: SupabaseClient,
  userId: string,
  sinceIso: string,
  cardIds: string[] | null,
): Promise<LogRow[]> {
  const pageSize = 1000;
  const rows: LogRow[] = [];
  for (let from = 0; ; from += pageSize) {
    let query = supabase
      .from("review_logs")
      .select("review, rating, card_id")
      .eq("user_id", userId)
      .gte("review", sinceIso)
      .order("review", { ascending: false })
      .range(from, from + pageSize - 1);
    if (cardIds) query = query.in("card_id", cardIds);

    const { data, error } = await query;
    if (error) {
      console.error("[getAdvancedStats] logs", error.message);
      break;
    }
    const batch = (data ?? []) as LogRow[];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
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

export async function getAdvancedStats(
  supabase: SupabaseClient,
  userId: string,
  deckId: string | null,
): Promise<AdvancedStats> {
  // Resolve the user's decks (names + the deck list used for per-deck rows).
  const { data: deckData } = await supabase
    .from("projects")
    .select("id, name, deck_name")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  const deckRows = (deckData ?? []) as DeckRow[];

  if (deckId && !deckRows.some((d) => d.id === deckId)) {
    throw new DeckNotFoundError();
  }

  const deckName = deckId
    ? (() => {
        const d = deckRows.find((r) => r.id === deckId);
        return d ? d.deck_name || d.name : null;
      })()
    : null;

  // Map every card in scope to its deck.
  const deckIds = deckRows.map((d) => d.id);
  const deckByCard = new Map<string, string>();
  const cardsByDeck = new Map<string, string[]>();

  if (deckIds.length > 0) {
    const cardQuery = supabase
      .from("cards")
      .select("id, generation_jobs!inner(source_id, sources!inner(project_id))");
    const { data: cardJoin } = deckId
      ? await cardQuery.eq("generation_jobs.sources.project_id", deckId)
      : await cardQuery.in("generation_jobs.sources.project_id", deckIds);

    for (const row of (cardJoin ?? []) as CardJoinRow[]) {
      const pid = projectIdOf(row);
      deckByCard.set(row.id, pid);
      const list = cardsByDeck.get(pid) ?? [];
      list.push(row.id);
      cardsByDeck.set(pid, list);
    }
  }

  const cardIds = Array.from(deckByCard.keys());
  const totalCards = cardIds.length;
  if (totalCards === 0) {
    return emptyStats(deckId, deckName);
  }

  const scopeCardIds = deckId ? cardIds : null; // null → all of user's cards

  const since90 = startOfDay(-(RATING_WINDOW_DAYS - 1)).toISOString();
  // Align the retention window with the daily series so the "30d" tile equals
  // the sum of the chart bars (today plus the previous 29 days).
  const since30 = startOfDay(-(RETENTION_WINDOW_DAYS - 1));
  const since200 = startOfDay(-STREAK_WINDOW_DAYS).toISOString();

  const [reviewsRes, totalReviewsRes, streakRes, recentLogs] = await Promise.all([
    (() => {
      let q = supabase
        .from("card_reviews")
        .select("card_id, due, state, stability, difficulty, scheduled_days, suspended")
        .eq("user_id", userId);
      if (scopeCardIds) q = q.in("card_id", scopeCardIds);
      return q;
    })(),
    (() => {
      let q = supabase
        .from("review_logs")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId);
      if (scopeCardIds) q = q.in("card_id", scopeCardIds);
      return q;
    })(),
    (() => {
      let q = supabase
        .from("review_logs")
        .select("review")
        .eq("user_id", userId)
        .gte("review", since200)
        .order("review", { ascending: false });
      if (scopeCardIds) q = q.in("card_id", scopeCardIds);
      return q;
    })(),
    fetchLogsSince(supabase, userId, since90, scopeCardIds),
  ]);

  const reviewRows = (reviewsRes.data ?? []) as ReviewRow[];
  const reviewByCard = new Map<string, ReviewRow>();
  for (const r of reviewRows) reviewByCard.set(r.card_id, r);

  // --- Card-state derived metrics (maturity, state breakdown, stability) ---
  const maturity: MaturityBreakdown = { new: 0, learning: 0, young: 0, mature: 0, suspended: 0 };
  const stateBreakdown: StateBreakdown = { new: 0, learning: 0, review: 0, relearning: 0 };
  let stabilitySum = 0;
  let stabilityCount = 0;
  let difficultySum = 0;
  let difficultyCount = 0;
  const now = Date.now();

  // Forecast buckets: day 0 (includes overdue) .. FORECAST_DAYS-1.
  const forecastEnd = startOfDay(FORECAST_DAYS).getTime();
  const forecastMap = new Map<string, number>();
  for (let i = 0; i < FORECAST_DAYS; i++) {
    forecastMap.set(toIsoDateKey(startOfDay(i)), 0);
  }
  const todayKey = toIsoDateKey(startOfDay(0));

  for (const cardId of cardIds) {
    const r = reviewByCard.get(cardId);
    if (!r || r.state === 0) {
      maturity.new += 1;
      stateBreakdown.new += 1;
      continue;
    }
    if (r.suspended) {
      maturity.suspended += 1;
    }

    if (r.state === 1) stateBreakdown.learning += 1;
    else if (r.state === 2) stateBreakdown.review += 1;
    else if (r.state === 3) stateBreakdown.relearning += 1;

    if (!r.suspended) {
      if (r.state === 1 || r.state === 3) {
        maturity.learning += 1;
      } else if (r.state === 2) {
        if (r.scheduled_days >= MATURE_INTERVAL_DAYS) maturity.mature += 1;
        else maturity.young += 1;
      }
    }

    if (r.state === 2) {
      stabilitySum += r.stability;
      stabilityCount += 1;
    }
    difficultySum += r.difficulty;
    difficultyCount += 1;

    // Upcoming workload.
    if (!r.suspended) {
      const dueMs = new Date(r.due).getTime();
      if (dueMs < forecastEnd) {
        const key = dueMs <= now ? todayKey : toIsoDateKey(new Date(dueMs));
        if (forecastMap.has(key)) forecastMap.set(key, (forecastMap.get(key) ?? 0) + 1);
        else if (dueMs <= now) forecastMap.set(todayKey, (forecastMap.get(todayKey) ?? 0) + 1);
      }
    }
  }

  const dueForecast: DayCount[] = Array.from(forecastMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({ date, count }));

  // --- Review-log derived metrics (ratings, retention, daily series) ---
  const ratingDistribution: RatingDistribution = { again: 0, hard: 0, good: 0, easy: 0 };
  const since30Ms = since30.getTime();
  let retentionTotal = 0;
  let retentionPassed = 0;

  const seriesMap = new Map<string, number>();
  for (let i = REVIEWS_SERIES_DAYS - 1; i >= 0; i--) {
    seriesMap.set(toIsoDateKey(startOfDay(-i)), 0);
  }

  for (const log of recentLogs) {
    switch (log.rating) {
      case 1:
        ratingDistribution.again += 1;
        break;
      case 2:
        ratingDistribution.hard += 1;
        break;
      case 3:
        ratingDistribution.good += 1;
        break;
      case 4:
        ratingDistribution.easy += 1;
        break;
    }

    const reviewMs = new Date(log.review).getTime();
    if (reviewMs >= since30Ms) {
      retentionTotal += 1;
      if (log.rating >= 2) retentionPassed += 1;
      const key = toIsoDateKey(new Date(reviewMs));
      if (seriesMap.has(key)) seriesMap.set(key, (seriesMap.get(key) ?? 0) + 1);
    }
  }

  const reviewsPerDay: DayCount[] = Array.from(seriesMap.entries()).map(([date, count]) => ({
    date,
    count,
  }));
  const reviews30d = retentionTotal;
  const retention30d = retentionTotal > 0 ? retentionPassed / retentionTotal : null;

  // --- Per-deck rows (only meaningful for the all-decks scope) ---
  const perDeck: DeckStatRow[] = [];
  if (!deckId) {
    const deckDue = new Map<string, number>();
    const deckMature = new Map<string, number>();
    for (const [cardId, pid] of deckByCard) {
      const r = reviewByCard.get(cardId);
      if (!r || r.suspended) continue;
      if (r.state !== 0 && new Date(r.due).getTime() <= now) {
        deckDue.set(pid, (deckDue.get(pid) ?? 0) + 1);
      }
      if (r.state === 2 && r.scheduled_days >= MATURE_INTERVAL_DAYS) {
        deckMature.set(pid, (deckMature.get(pid) ?? 0) + 1);
      }
    }

    const deckReviews = new Map<string, number>();
    const deckPassed = new Map<string, number>();
    for (const log of recentLogs) {
      const pid = deckByCard.get(log.card_id);
      if (!pid) continue;
      deckReviews.set(pid, (deckReviews.get(pid) ?? 0) + 1);
      if (log.rating >= 2) deckPassed.set(pid, (deckPassed.get(pid) ?? 0) + 1);
    }

    for (const deck of deckRows) {
      const total = cardsByDeck.get(deck.id)?.length ?? 0;
      if (total === 0) continue;
      const reviews = deckReviews.get(deck.id) ?? 0;
      const passed = deckPassed.get(deck.id) ?? 0;
      perDeck.push({
        deck_id: deck.id,
        name: deck.deck_name || deck.name,
        total_cards: total,
        due: deckDue.get(deck.id) ?? 0,
        mature: deckMature.get(deck.id) ?? 0,
        reviews_90d: reviews,
        retention_90d: reviews > 0 ? passed / reviews : null,
      });
    }

    perDeck.sort((a, b) => b.total_cards - a.total_cards);
  }

  const streak = computeStreak(
    ((streakRes.data ?? []) as { review: string }[]).map((l) => l.review),
  );

  return {
    scope: { deck_id: deckId, deck_name: deckName },
    total_cards: totalCards,
    total_reviews: totalReviewsRes.count ?? 0,
    reviews_30d: reviews30d,
    retention_30d: retention30d,
    retention_window_days: RETENTION_WINDOW_DAYS,
    rating_window_days: RATING_WINDOW_DAYS,
    mature_cards: maturity.mature,
    avg_stability: stabilityCount > 0 ? stabilitySum / stabilityCount : null,
    avg_difficulty: difficultyCount > 0 ? difficultySum / difficultyCount : null,
    streak,
    rating_distribution: ratingDistribution,
    maturity,
    state_breakdown: stateBreakdown,
    reviews_per_day: reviewsPerDay,
    due_forecast: dueForecast,
    per_deck: perDeck,
  };
}
