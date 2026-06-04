import type { SupabaseClient } from "@supabase/supabase-js";
import { toDayKey, toIsoDateKey } from "@/lib/fsrs/date-utils";
import { settingsFromRecord } from "@/lib/fsrs/settings";
import {
  countDueStudyCards,
  countNewReviewsTodayForDeck,
  countNewStudyCards,
} from "@/lib/study/queue";

export interface DeckCounts {
  total: number;
  due: number;
  new: number;
  learning: number;
  review_only: number;
  new_today_remaining: number;
}

import { loadDashboardMetricsBundle, totalsFromPerDeck } from "@/lib/fsrs/dashboard-metrics";

function startOfDay(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

async function fetchStudyDayKeys(
  supabase: SupabaseClient,
  userId: string,
  since: Date,
): Promise<string[]> {
  const { data, error } = await supabase.rpc("get_user_study_days", {
    p_user_id: userId,
    p_since: since.toISOString(),
  });

  if (!error && data) {
    return (data as Array<{ day: string }>).map((row) => {
      const day = String(row.day).slice(0, 10);
      return `${day}T12:00:00.000Z`;
    });
  }

  const { data: logs } = await supabase
    .from("review_logs")
    .select("review")
    .eq("user_id", userId)
    .gte("review", since.toISOString())
    .order("review", { ascending: false })
    .limit(2000);

  return ((logs ?? []) as { review: string }[]).map((l) => l.review);
}

/**
 * Per-deck queue counts via indexed RPCs (no full card/review scan).
 */
export async function getDeckCounts(
  supabase: SupabaseClient,
  deckId: string,
  userId: string,
  projectSettings?: unknown,
): Promise<DeckCounts> {
  let settings = settingsFromRecord(projectSettings);
  if (projectSettings === undefined) {
    const { data: project } = await supabase
      .from("projects")
      .select("settings")
      .eq("id", deckId)
      .eq("user_id", userId)
      .maybeSingle();
    settings = settingsFromRecord(project?.settings);
  }

  const nowIso = new Date().toISOString();
  const startOfDayIso = startOfDay().toISOString();

  const [{ data: cardCountRows }, newToday, due, newCount] = await Promise.all([
    supabase.rpc("count_cards_by_projects", { p_project_ids: [deckId] }),
    countNewReviewsTodayForDeck(supabase, deckId, userId, startOfDayIso),
    countDueStudyCards(supabase, deckId, userId, nowIso),
    countNewStudyCards(supabase, deckId, userId),
  ]);

  const total = Number(
    ((cardCountRows ?? []) as Array<{ card_count: number }>)[0]?.card_count ?? 0,
  );

  if (total === 0) {
    return {
      total: 0,
      due: 0,
      new: 0,
      learning: 0,
      review_only: 0,
      new_today_remaining: settings.newCardsPerDay,
    };
  }

  const newSupply = Math.max(0, settings.newCardsPerDay - newToday);

  return {
    total,
    due,
    new: newCount,
    learning: 0,
    review_only: 0,
    new_today_remaining: Math.min(newCount, newSupply),
  };
}

export interface DashboardOverviewStats {
  reviewed_today: number;
  retention_pct: number | null;
  streak: number;
  due_now: number;
  new_today_remaining: number;
  total_cards: number;
  state_breakdown: { new: number; learning: number; review: number; relearning: number };
}

export interface DashboardStats extends DashboardOverviewStats {
  cards_learned_today: number;
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

/**
 * Overview metrics for the dashboard panel (heatmap loads separately).
 */
export async function getDashboardOverviewStats(
  supabase: SupabaseClient,
  userId: string,
): Promise<DashboardOverviewStats> {
  const startOfDayIso = startOfDay().toISOString();
  const since30d = new Date();
  since30d.setDate(since30d.getDate() - 30);
  const since200d = new Date();
  since200d.setDate(since200d.getDate() - 200);

  const [
    metrics,
    { count: reviewedToday },
    { count: recentTotal },
    { count: recentPassed },
    studyDays,
  ] = await Promise.all([
    loadDashboardMetricsBundle(userId),
    supabase
      .from("review_logs")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("review", startOfDayIso),
    supabase
      .from("review_logs")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("review", since30d.toISOString()),
    supabase
      .from("review_logs")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("review", since30d.toISOString())
      .gte("rating", 2),
    fetchStudyDayKeys(supabase, userId, since200d),
  ]);

  let retentionPct: number | null = null;
  if (recentTotal && recentTotal > 0) {
    retentionPct = (recentPassed ?? 0) / recentTotal;
  }

  const streak = computeStreak(studyDays);
  const { dueNow, newTodayRemaining } = totalsFromPerDeck(metrics.perDeck);

  return {
    reviewed_today: reviewedToday ?? 0,
    retention_pct: retentionPct,
    streak,
    due_now: dueNow,
    new_today_remaining: newTodayRemaining,
    total_cards: metrics.totalCards,
    state_breakdown: metrics.stateBreakdown,
  };
}

/**
 * Build the dashboard summary using batched SQL metrics (no full-library row scans).
 */
export async function getDashboardStats(
  supabase: SupabaseClient,
  userId: string,
): Promise<DashboardStats> {
  const startOfDayIso = startOfDay().toISOString();

  const [
    overview,
    metrics,
    { count: cardsLearnedToday },
    { count: totalReviewLogs },
    { data: fsrsParamsRow },
  ] = await Promise.all([
    getDashboardOverviewStats(supabase, userId),
    loadDashboardMetricsBundle(userId),
    supabase
      .from("review_logs")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("state", 0)
      .gte("review", startOfDayIso),
    supabase
      .from("review_logs")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId),
    supabase.from("user_fsrs_params").select("optimized_at").eq("user_id", userId).maybeSingle(),
  ]);

  return {
    ...overview,
    cards_learned_today: cardsLearnedToday ?? 0,
    per_deck: metrics.perDeck,
    last_optimized_at: (fsrsParamsRow as { optimized_at?: string } | null)?.optimized_at ?? null,
    fsrs_log_count: totalReviewLogs ?? 0,
  };
}

function computeStreak(reviewTimes: string[]): number {
  if (reviewTimes.length === 0) return 0;
  const dayKeys = new Set<string>();
  for (const t of reviewTimes) dayKeys.add(toDayKey(new Date(t)));
  let streak = 0;
  let cursor = new Date();
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

export interface ReviewHeatmapData {
  year: number;
  counts: Record<string, number>;
}

export async function getReviewHeatmap(
  supabase: SupabaseClient,
  userId: string,
  year = new Date().getFullYear(),
): Promise<ReviewHeatmapData> {
  const start = new Date(year, 0, 1);
  const today = new Date();
  const end =
    year === today.getFullYear()
      ? today
      : new Date(year, 11, 31, 23, 59, 59, 999);

  const counts: Record<string, number> = {};

  const { data: rpcRows, error: rpcError } = await supabase.rpc("review_counts_by_day", {
    p_user_id: userId,
    p_start: start.toISOString(),
    p_end: end.toISOString(),
  });

  if (!rpcError && rpcRows) {
    for (const row of rpcRows as { day: string; count: number }[]) {
      counts[row.day] = Number(row.count);
    }
    return { year, counts };
  }

  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("review_logs")
      .select("review")
      .eq("user_id", userId)
      .gte("review", start.toISOString())
      .lte("review", end.toISOString())
      .order("review", { ascending: true })
      .range(from, from + pageSize - 1);

    if (error) {
      console.error("[getReviewHeatmap]", error.message);
      break;
    }

    for (const row of (data ?? []) as { review: string }[]) {
      const key = toIsoDateKey(new Date(row.review));
      counts[key] = (counts[key] ?? 0) + 1;
    }

    if (!data || data.length < pageSize) break;
  }

  return { year, counts };
}
