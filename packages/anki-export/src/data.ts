import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExportCardProgress } from "@deephaus/apkg";

/** PostgREST returns at most this many rows per request. */
const PAGE_SIZE = 1000;
/** Card ids per `.in()` filter, keeping request URLs short. */
const ID_CHUNK = 200;

export type ExportCardRow = {
  id: string;
  type: "basic" | "cloze";
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  tags: string[];
};

export interface ExportTarget {
  deckName: string;
  /** Generation jobs whose cards make up the export. */
  jobIds: string[];
}

/**
 * The deck name and generation jobs an export covers, or null when the user
 * does not own the project (or the requested job is not in it).
 */
export async function resolveExportTarget(
  supabase: SupabaseClient,
  userId: string,
  projectId: string,
  generationJobId: string | null,
): Promise<ExportTarget | null> {
  const { data: project } = await supabase
    .from("projects")
    .select("deck_name")
    .eq("id", projectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!project) return null;
  const deckName = String(project.deck_name ?? "deck");

  if (generationJobId) {
    const { data: job } = await supabase
      .from("generation_jobs")
      .select("id, sources!inner(project_id, projects!inner(user_id))")
      .eq("id", generationJobId)
      .eq("sources.project_id", projectId)
      .eq("sources.projects.user_id", userId)
      .maybeSingle();
    return job ? { deckName, jobIds: [generationJobId] } : null;
  }

  const { data: jobs } = await supabase
    .from("generation_jobs")
    .select("id, sources!inner(project_id, projects!inner(user_id))")
    .eq("sources.project_id", projectId)
    .eq("sources.projects.user_id", userId);
  return { deckName, jobIds: (jobs ?? []).map((job) => job.id as string) };
}

/** Number of exportable cards across these jobs. */
export async function countExportCards(supabase: SupabaseClient, jobIds: string[]): Promise<number> {
  if (jobIds.length === 0) return 0;
  const { count, error } = await supabase
    .from("cards")
    .select("id", { count: "exact", head: true })
    .in("job_id", jobIds)
    .in("type", ["basic", "cloze"]);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** True when any exportable card embeds media: a markdown or `<img>` image, or an `<audio>` clip. */
export async function exportHasMedia(supabase: SupabaseClient, jobIds: string[]): Promise<boolean> {
  if (jobIds.length === 0) return false;
  const fields = ["front", "back", "cloze_text", "extra"];
  const patterns = fields.flatMap((field) => [`${field}.ilike.%<img%`, `${field}.ilike.%<audio%`, `${field}.like.%](%`]);
  const { data, error } = await supabase
    .from("cards")
    .select("id")
    .in("job_id", jobIds)
    .in("type", ["basic", "cloze"])
    .or(patterns.join(","))
    .limit(1);
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

/** Every exportable card for these jobs, in deck order, paging past the row cap. */
export async function loadExportCards(supabase: SupabaseClient, jobIds: string[]): Promise<ExportCardRow[]> {
  if (jobIds.length === 0) return [];
  const cards: ExportCardRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("cards")
      .select("id, type, front, back, cloze_text, extra, tags")
      .in("job_id", jobIds)
      .in("type", ["basic", "cloze"])
      .order("sort_order", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as ExportCardRow[];
    cards.push(...page);
    if (page.length < PAGE_SIZE) return cards;
  }
}

/** Every row of `table` for these cards, paging past the PostgREST row cap. */
async function loadByCard<T extends { card_id: string }>(
  supabase: SupabaseClient,
  table: "card_reviews" | "review_logs",
  columns: string,
  userId: string,
  cardIds: string[],
): Promise<T[]> {
  const rows: T[] = [];
  for (let i = 0; i < cardIds.length; i += ID_CHUNK) {
    const ids = cardIds.slice(i, i + ID_CHUNK);
    for (let from = 0; ; from += PAGE_SIZE) {
      let query = supabase.from(table).select(columns).eq("user_id", userId).in("card_id", ids);
      if (table === "review_logs") query = query.eq("undone", false);
      const { data, error } = await query.order("id", { ascending: true }).range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(error.message);
      const page = (data ?? []) as unknown as T[];
      rows.push(...page);
      if (page.length < PAGE_SIZE) break;
    }
  }
  return rows;
}

/** The user's schedule and review history for each card, parallel to `cardIds`. */
export async function loadExportProgress(
  supabase: SupabaseClient,
  userId: string,
  cardIds: string[],
): Promise<Array<ExportCardProgress | undefined>> {
  type ReviewRow = {
    card_id: string; cloze_ord: number; due: string; stability: number; difficulty: number;
    scheduled_days: number; reps: number; lapses: number; state: number; suspended: boolean;
  };
  type LogRow = { card_id: string; cloze_ord: number | null; rating: number; state: number; scheduled_days: number; review: string };

  const [reviews, logs] = await Promise.all([
    loadByCard<ReviewRow>(supabase, "card_reviews",
      "card_id, cloze_ord, due, stability, difficulty, scheduled_days, reps, lapses, state, suspended", userId, cardIds),
    loadByCard<LogRow>(supabase, "review_logs",
      "id, card_id, cloze_ord, rating, state, scheduled_days, review", userId, cardIds),
  ]);

  const byCard = new Map<string, ExportCardProgress>();
  const entry = (cardId: string) => {
    let progress = byCard.get(cardId);
    if (!progress) byCard.set(cardId, (progress = { reviews: [], logs: [] }));
    return progress;
  };
  for (const r of reviews) {
    entry(r.card_id).reviews.push({
      clozeOrd: r.cloze_ord, due: r.due, stability: r.stability, difficulty: r.difficulty,
      scheduledDays: r.scheduled_days, reps: r.reps, lapses: r.lapses, state: r.state, suspended: r.suspended,
    });
  }
  for (const l of logs) {
    entry(l.card_id).logs.push({
      clozeOrd: l.cloze_ord ?? 0, rating: l.rating, state: l.state, scheduledDays: l.scheduled_days, review: l.review,
    });
  }
  return cardIds.map((id) => byCard.get(id));
}
