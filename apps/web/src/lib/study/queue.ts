import type { SupabaseClient } from "@supabase/supabase-js";
import type { CardReviewRow } from "@/lib/fsrs/scheduler";

export type StudyCardRow = {
  id: string;
  type: string;
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  sort_order: number;
};

type DueReviewRow = CardReviewRow & {
  card_id: string;
  cards: StudyCardRow & {
    generation_jobs:
      | { sources: { project_id: string } | { project_id: string }[] }
      | Array<{ sources: { project_id: string } | { project_id: string }[] }>;
  };
};

function unwrapProjectId(row: DueReviewRow): string | null {
  const gj = Array.isArray(row.cards.generation_jobs)
    ? row.cards.generation_jobs[0]
    : row.cards.generation_jobs;
  if (!gj) return null;
  const src = Array.isArray(gj.sources) ? gj.sources[0] : gj.sources;
  return src?.project_id ?? null;
}

/** Due reviews for a deck with card content — does not load non-due cards. */
export async function fetchDueStudyRows(
  supabase: SupabaseClient,
  deckId: string,
  userId: string,
  nowIso: string,
) {
  const { data, error } = await supabase
    .from("card_reviews")
    .select(
      `card_id, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review, learning_steps,
      cards!inner (
        id, type, front, back, cloze_text, extra, sort_order,
        generation_jobs!inner ( sources!inner ( project_id ) )
      )`,
    )
    .eq("user_id", userId)
    .lte("due", nowIso)
    .eq("cards.generation_jobs.sources.project_id", deckId);

  if (error) throw new Error(error.message);

  return ((data ?? []) as unknown[]).flatMap((raw) => {
    const row = raw as Record<string, unknown>;
    const cardsRaw = row.cards;
    const card = Array.isArray(cardsRaw) ? cardsRaw[0] : cardsRaw;
    if (!card || typeof card !== "object") return [];
    const normalized = { ...row, cards: card } as DueReviewRow;
    return unwrapProjectId(normalized) === deckId ? [normalized] : [];
  });
}

export async function fetchNewStudyCards(
  supabase: SupabaseClient,
  deckId: string,
  userId: string,
  limit: number,
): Promise<StudyCardRow[]> {
  const { data, error } = await supabase.rpc("fetch_new_study_cards", {
    p_deck_id: deckId,
    p_user_id: userId,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as StudyCardRow[];
}

export async function countNewStudyCards(
  supabase: SupabaseClient,
  deckId: string,
  userId: string,
): Promise<number> {
  const { data, error } = await supabase.rpc("count_new_study_cards", {
    p_deck_id: deckId,
    p_user_id: userId,
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

export async function countNewReviewsTodayForDeck(
  supabase: SupabaseClient,
  deckId: string,
  userId: string,
  startOfDayIso: string,
): Promise<number> {
  const { data, error } = await supabase.rpc("count_new_reviews_today_for_deck", {
    p_deck_id: deckId,
    p_user_id: userId,
    p_start_of_day: startOfDayIso,
  });
  if (error) throw new Error(error.message);
  return Number(data ?? 0);
}

export function sortDueRows(rows: DueReviewRow[]) {
  return [...rows].sort((a, b) => {
    const pa = a.state === 1 || a.state === 3 ? 0 : 1;
    const pb = b.state === 1 || b.state === 3 ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return new Date(a.due).getTime() - new Date(b.due).getTime();
  });
}

export function dueRowToCard(row: DueReviewRow): StudyCardRow {
  return {
    id: row.cards.id,
    type: row.cards.type,
    front: row.cards.front,
    back: row.cards.back,
    cloze_text: row.cards.cloze_text,
    extra: row.cards.extra,
    sort_order: row.cards.sort_order,
  };
}

export function reviewFieldsFromDueRow(row: DueReviewRow): CardReviewRow & { card_id: string } {
  return {
    card_id: row.card_id,
    due: row.due,
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsed_days,
    scheduled_days: row.scheduled_days,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state,
    last_review: row.last_review,
    learning_steps: row.learning_steps,
  };
}
