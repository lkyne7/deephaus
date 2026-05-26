import type { SupabaseClient } from "@supabase/supabase-js";
import { settingsFromRecord } from "@/lib/fsrs/settings";

export interface DeckCounts {
  total: number;
  due: number;
  new: number;
  learning: number;
  review_only: number;
  new_today_remaining: number;
}

interface CardJoin {
  id: string;
}

interface ReviewRow {
  card_id: string;
  due: string;
  state: number;
}

/**
 * Compute per-deck queue counts without instantiating FSRS.
 *
 * "due" includes review + learning + relearning cards whose due time has
 * already passed; "new" is the count of new cards remaining in the deck.
 * `new_today_remaining` reflects the deck-level newCardsPerDay budget after
 * subtracting today's already-studied new cards.
 */
export async function getDeckCounts(
  supabase: SupabaseClient,
  deckId: string,
  userId: string,
): Promise<DeckCounts> {
  const { data: project } = await supabase
    .from("projects")
    .select("settings")
    .eq("id", deckId)
    .eq("user_id", userId)
    .maybeSingle();

  const settings = settingsFromRecord(project?.settings);

  const { data: cards } = await supabase
    .from("cards")
    .select("id, generation_jobs!inner(source_id, sources!inner(project_id))")
    .eq("generation_jobs.sources.project_id", deckId);

  const cardIds = ((cards ?? []) as unknown as CardJoin[]).map((c) => c.id);
  if (cardIds.length === 0) {
    return {
      total: 0,
      due: 0,
      new: 0,
      learning: 0,
      review_only: 0,
      new_today_remaining: settings.newCardsPerDay,
    };
  }

  const { data: reviews } = await supabase
    .from("card_reviews")
    .select("card_id, due, state")
    .eq("user_id", userId)
    .in("card_id", cardIds);

  const byId = new Map<string, ReviewRow>();
  for (const r of (reviews ?? []) as ReviewRow[]) byId.set(r.card_id, r);

  const now = Date.now();
  let due = 0;
  let learning = 0;
  let reviewOnly = 0;
  let newCount = 0;
  for (const id of cardIds) {
    const r = byId.get(id);
    if (!r || r.state === 0) {
      newCount += 1;
      continue;
    }
    if (new Date(r.due).getTime() <= now) {
      due += 1;
      if (r.state === 1 || r.state === 3) learning += 1;
      else reviewOnly += 1;
    }
  }

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const { data: newTodayLogs } = await supabase
    .from("review_logs")
    .select("card_id")
    .eq("user_id", userId)
    .in("card_id", cardIds)
    .eq("state", 0)
    .gte("review", startOfDay.toISOString());

  const newToday = newTodayLogs?.length ?? 0;
  const newSupply = Math.max(0, settings.newCardsPerDay - newToday);

  return {
    total: cardIds.length,
    due,
    new: newCount,
    learning,
    review_only: reviewOnly,
    new_today_remaining: Math.min(newCount, newSupply),
  };
}

export interface DashboardStats {
  reviewed_today: number;
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

/**
 * Build the dashboard summary. Where possible we read aggregate columns from
 * review_logs to avoid pulling every row.
 *
 * The streak rule is: count consecutive days, ending today, on which the user
 * has at least one review log entry; if there's no entry for today and there
 * was one yesterday, the streak count continues with yesterday as its endpoint.
 */
export async function getDashboardStats(
  supabase: SupabaseClient,
  userId: string,
): Promise<DashboardStats> {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const since30d = new Date();
  since30d.setDate(since30d.getDate() - 30);

  const [
    { count: reviewedToday },
    { count: recentTotal },
    { count: recentPassed },
    { data: streakLogs },
    { data: decks },
    { data: fsrsParamsRow },
  ] = await Promise.all([
    supabase
      .from("review_logs")
      .select("*", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("review", startOfDay.toISOString()),
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
    supabase
      .from("review_logs")
      .select("review")
      .eq("user_id", userId)
      .order("review", { ascending: false })
      .limit(5000),
    supabase
      .from("projects")
      .select("id, name, deck_name, settings")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false }),
    supabase.from("user_fsrs_params").select("optimized_at, log_count").eq("user_id", userId).maybeSingle(),
  ]);

  let retentionPct: number | null = null;
  if (recentTotal && recentTotal > 0) {
    retentionPct = (recentPassed ?? 0) / recentTotal;
  }

  const streak = computeStreak(((streakLogs ?? []) as { review: string }[]).map((l) => l.review));

  const deckRows = (decks ?? []) as Array<{
    id: string;
    name: string;
    deck_name: string | null;
    settings: unknown;
  }>;
  const deckIds = deckRows.map((d) => d.id);

  const breakdown = { new: 0, learning: 0, review: 0, relearning: 0 };
  let totalCards = 0;
  let dueNow = 0;
  let newTodayRemainingTotal = 0;
  const perDeck: DashboardStats["per_deck"] = [];

  if (deckIds.length > 0) {
    // All cards belonging to this user's decks (one query).
    const { data: cardJoin } = await supabase
      .from("cards")
      .select("id, generation_jobs!inner(source_id, sources!inner(project_id))")
      .in("generation_jobs.sources.project_id", deckIds);

    const cardsByDeck = new Map<string, string[]>();
    for (const row of (cardJoin ?? []) as Array<{
      id: string;
      generation_jobs: { sources: { project_id: string } | { project_id: string }[] } | Array<{ sources: { project_id: string } | { project_id: string }[] }>;
    }>) {
      const gj = Array.isArray(row.generation_jobs) ? row.generation_jobs[0] : row.generation_jobs;
      const src = Array.isArray(gj.sources) ? gj.sources[0] : gj.sources;
      const deckId = src.project_id;
      const list = cardsByDeck.get(deckId) ?? [];
      list.push(row.id);
      cardsByDeck.set(deckId, list);
      totalCards += 1;
    }

    const allCardIds = Array.from(cardsByDeck.values()).flat();
    let allReviews: Array<{ card_id: string; due: string; state: number }> = [];
    if (allCardIds.length > 0) {
      const { data } = await supabase
        .from("card_reviews")
        .select("card_id, due, state")
        .eq("user_id", userId)
        .in("card_id", allCardIds);
      allReviews = (data ?? []) as typeof allReviews;
    }
    const reviewById = new Map<string, { card_id: string; due: string; state: number }>();
    for (const r of allReviews) reviewById.set(r.card_id, r);

    // New-card budget consumed today, across all decks (deck-by-deck).
    let newLogsByDeck = new Map<string, number>();
    if (allCardIds.length > 0) {
      const { data: newLogs } = await supabase
        .from("review_logs")
        .select("card_id")
        .eq("user_id", userId)
        .eq("state", 0)
        .gte("review", startOfDay.toISOString())
        .in("card_id", allCardIds);
      for (const l of (newLogs ?? []) as { card_id: string }[]) {
        for (const [deckId, ids] of cardsByDeck) {
          if (ids.includes(l.card_id)) {
            newLogsByDeck.set(deckId, (newLogsByDeck.get(deckId) ?? 0) + 1);
            break;
          }
        }
      }
    }

    // Last-review timestamp per deck.
    const lastReviewByDeck = new Map<string, string>();
    if (allCardIds.length > 0) {
      const { data: lastLogs } = await supabase
        .from("review_logs")
        .select("card_id, review")
        .eq("user_id", userId)
        .in("card_id", allCardIds)
        .order("review", { ascending: false })
        .limit(2000);
      for (const log of (lastLogs ?? []) as { card_id: string; review: string }[]) {
        for (const [deckId, ids] of cardsByDeck) {
          if (lastReviewByDeck.has(deckId)) continue;
          if (ids.includes(log.card_id)) {
            lastReviewByDeck.set(deckId, log.review);
            break;
          }
        }
      }
    }

    const now = Date.now();
    for (const deck of deckRows) {
      const settings = settingsFromRecord(deck.settings);
      const ids = cardsByDeck.get(deck.id) ?? [];
      let deckDue = 0;
      let deckNew = 0;
      for (const id of ids) {
        const r = reviewById.get(id);
        if (!r || r.state === 0) {
          deckNew += 1;
          breakdown.new += 1;
          continue;
        }
        if (r.state === 1) breakdown.learning += 1;
        else if (r.state === 2) breakdown.review += 1;
        else if (r.state === 3) breakdown.relearning += 1;
        if (new Date(r.due).getTime() <= now) deckDue += 1;
      }
      const usedToday = newLogsByDeck.get(deck.id) ?? 0;
      const deckNewSupply = Math.max(0, settings.newCardsPerDay - usedToday);
      const deckNewToday = Math.min(deckNew, deckNewSupply);

      newTodayRemainingTotal += deckNewToday;
      dueNow += deckDue;

      perDeck.push({
        deck_id: deck.id,
        name: deck.deck_name || deck.name,
        due: deckDue,
        new: deckNewToday,
        last_reviewed: lastReviewByDeck.get(deck.id) ?? null,
        total: ids.length,
      });
    }
  }

  return {
    reviewed_today: reviewedToday ?? 0,
    retention_pct: retentionPct,
    streak,
    due_now: dueNow,
    new_today_remaining: newTodayRemainingTotal,
    total_cards: totalCards,
    state_breakdown: breakdown,
    per_deck: perDeck,
    last_optimized_at: (fsrsParamsRow as { optimized_at?: string } | null)?.optimized_at ?? null,
    fsrs_log_count: (fsrsParamsRow as { log_count?: number } | null)?.log_count ?? 0,
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
    // No review today — try yesterday as the streak's endpoint.
    cursor.setDate(cursor.getDate() - 1);
    if (!dayKeys.has(toDayKey(cursor))) return 0;
  }
  while (dayKeys.has(toDayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function toDayKey(d: Date) {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
