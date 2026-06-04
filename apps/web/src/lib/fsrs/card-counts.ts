import type { SupabaseClient } from "@supabase/supabase-js";

const PAGE_SIZE = 1000;
const IN_BATCH = 200;

export type CardStateBreakdown = {
  new: number;
  learning: number;
  review: number;
  relearning: number;
};

export function sumBreakdown(breakdown: CardStateBreakdown): number {
  return breakdown.new + breakdown.learning + breakdown.review + breakdown.relearning;
}

function parseStateBreakdownPayload(data: unknown): CardStateBreakdown | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return null;

  const record = row as Record<string, unknown>;
  return {
    new: Number(record.state_new ?? 0),
    learning: Number(record.state_learning ?? 0),
    review: Number(record.state_review ?? 0),
    relearning: Number(record.state_relearning ?? 0),
  };
}

/** Exact total cards for a user (not limited to 1000 PostgREST rows). */
export async function countTotalUserCards(
  supabase: SupabaseClient,
  userId: string,
  deckIds: string[],
): Promise<number> {
  if (deckIds.length === 0) return 0;

  const { data, error } = await supabase.rpc("count_user_cards", { p_user_id: userId });
  if (!error && data != null) {
    return Number(data);
  }

  return sumCardCountsByDeck(supabase, deckIds);
}

export async function countDeckCards(
  supabase: SupabaseClient,
  deckId: string,
): Promise<number> {
  const { data, error } = await supabase.rpc("count_cards_by_projects", {
    p_project_ids: [deckId],
  });
  if (!error && data != null) {
    return Number(((data ?? []) as Array<{ card_count: number }>)[0]?.card_count ?? 0);
  }

  const ids = await loadScopedCardIds(supabase, [deckId], deckId);
  return ids.length;
}

export async function sumCardCountsByDeck(
  supabase: SupabaseClient,
  deckIds: string[],
): Promise<number> {
  if (deckIds.length === 0) return 0;

  const { data, error } = await supabase.rpc("count_cards_by_projects", {
    p_project_ids: deckIds,
  });
  if (error) {
    const ids = await loadScopedCardIds(supabase, deckIds, null);
    return ids.length;
  }

  return ((data ?? []) as Array<{ card_count: number }>).reduce(
    (sum, row) => sum + Number(row.card_count ?? 0),
    0,
  );
}

export async function fetchCardCountsByDeck(
  supabase: SupabaseClient,
  deckIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (deckIds.length === 0) return map;

  const { data, error } = await supabase.rpc("count_cards_by_projects", {
    p_project_ids: deckIds,
  });
  if (error) {
    const { cardsByDeck } = await loadDeckCardIndex(supabase, deckIds, null);
    for (const [projectId, ids] of cardsByDeck) {
      map.set(projectId, ids.length);
    }
    return map;
  }

  for (const row of (data ?? []) as Array<{ project_id: string; card_count: number }>) {
    map.set(row.project_id, Number(row.card_count ?? 0));
  }
  return map;
}

export async function fetchStateBreakdown(
  supabase: SupabaseClient,
  userId: string,
  deckIds: string[],
): Promise<CardStateBreakdown> {
  const { data, error } = await supabase.rpc("get_user_card_state_breakdown", {
    p_user_id: userId,
  });

  if (!error) {
    const parsed = parseStateBreakdownPayload(data);
    if (parsed) return parsed;
  } else if (
    error.code !== "PGRST202" &&
    !/get_user_card_state_breakdown/i.test(error.message ?? "")
  ) {
    throw new Error(error.message);
  }

  return computeStateBreakdownPaginated(supabase, userId, deckIds);
}

type CardJoinRow = {
  id: string;
  generation_jobs:
    | { sources: { project_id: string } | { project_id: string }[] }
    | Array<{ sources: { project_id: string } | { project_id: string }[] }>;
};

async function loadScopedCardIds(
  supabase: SupabaseClient,
  deckIds: string[],
  singleDeckId: string | null,
): Promise<string[]> {
  const ids: string[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from("cards")
      .select("id, generation_jobs!inner(source_id, sources!inner(project_id))");

    query = singleDeckId
      ? query.eq("generation_jobs.sources.project_id", singleDeckId)
      : query.in("generation_jobs.sources.project_id", deckIds);

    const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);

    const page = (data ?? []) as CardJoinRow[];
    for (const row of page) ids.push(row.id);
    if (page.length < PAGE_SIZE) break;
  }

  return ids;
}

async function computeStateBreakdownPaginated(
  supabase: SupabaseClient,
  userId: string,
  deckIds: string[],
  singleDeckId: string | null = null,
): Promise<CardStateBreakdown> {
  const breakdown: CardStateBreakdown = { new: 0, learning: 0, review: 0, relearning: 0 };
  const cardIds = await loadScopedCardIds(supabase, deckIds, singleDeckId);

  for (let i = 0; i < cardIds.length; i += IN_BATCH) {
    const chunk = cardIds.slice(i, i + IN_BATCH);
    const { data, error } = await supabase
      .from("card_reviews")
      .select("card_id, state, suspended, cloze_ord")
      .eq("user_id", userId)
      .in("card_id", chunk)
      .order("cloze_ord", { ascending: true });

    if (error) throw new Error(error.message);

    const primaryByCard = new Map<string, { state: number; suspended: boolean }>();
    for (const row of (data ?? []) as Array<{
      card_id: string;
      state: number;
      suspended: boolean;
      cloze_ord: number;
    }>) {
      if (!primaryByCard.has(row.card_id)) {
        primaryByCard.set(row.card_id, {
          state: row.state,
          suspended: Boolean(row.suspended),
        });
      }
    }

    for (const cardId of chunk) {
      const r = primaryByCard.get(cardId);
      if (!r) {
        breakdown.new += 1;
        continue;
      }
      if (r.suspended) continue;
      if (r.state === 0) {
        breakdown.new += 1;
        continue;
      }
      if (r.state === 1) breakdown.learning += 1;
      else if (r.state === 2) breakdown.review += 1;
      else if (r.state === 3) breakdown.relearning += 1;
    }
  }

  return breakdown;
}

export async function fetchScopedCardIds(
  supabase: SupabaseClient,
  deckIds: string[],
  deckId: string | null,
): Promise<string[]> {
  if (deckId) return loadScopedCardIds(supabase, deckIds, deckId);
  return loadScopedCardIds(supabase, deckIds, null);
}

export async function loadDeckCardIndex(
  supabase: SupabaseClient,
  deckIds: string[],
  singleDeckId: string | null,
): Promise<{ deckByCard: Map<string, string>; cardsByDeck: Map<string, string[]> }> {
  const deckByCard = new Map<string, string>();
  const cardsByDeck = new Map<string, string[]>();

  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from("cards")
      .select("id, generation_jobs!inner(source_id, sources!inner(project_id))");

    query = singleDeckId
      ? query.eq("generation_jobs.sources.project_id", singleDeckId)
      : query.in("generation_jobs.sources.project_id", deckIds);

    const { data, error } = await query.range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);

    const page = (data ?? []) as CardJoinRow[];
    for (const row of page) {
      const gj = Array.isArray(row.generation_jobs) ? row.generation_jobs[0] : row.generation_jobs;
      const src = Array.isArray(gj.sources) ? gj.sources[0] : gj.sources;
      const pid = src.project_id;
      deckByCard.set(row.id, pid);
      const list = cardsByDeck.get(pid) ?? [];
      list.push(row.id);
      cardsByDeck.set(pid, list);
    }

    if (page.length < PAGE_SIZE) break;
  }

  return { deckByCard, cardsByDeck };
}

export async function fetchReviewsForCardIds(
  supabase: SupabaseClient,
  userId: string,
  cardIds: string[],
): Promise<
  Map<
    string,
    {
      card_id: string;
      due: string;
      state: number;
      stability: number;
      difficulty: number;
      scheduled_days: number;
      suspended: boolean | null;
    }
  >
> {
  const byCard = new Map<
    string,
    {
      card_id: string;
      due: string;
      state: number;
      stability: number;
      difficulty: number;
      scheduled_days: number;
      suspended: boolean | null;
    }
  >();

  for (let i = 0; i < cardIds.length; i += IN_BATCH) {
    const chunk = cardIds.slice(i, i + IN_BATCH);
    const { data, error } = await supabase
      .from("card_reviews")
      .select("card_id, due, state, stability, difficulty, scheduled_days, suspended, cloze_ord")
      .eq("user_id", userId)
      .in("card_id", chunk)
      .order("cloze_ord", { ascending: true });

    if (error) throw new Error(error.message);

    for (const row of (data ?? []) as Array<{
      card_id: string;
      due: string;
      state: number;
      stability: number;
      difficulty: number;
      scheduled_days: number;
      suspended: boolean | null;
      cloze_ord: number;
    }>) {
      if (!byCard.has(row.card_id)) {
        byCard.set(row.card_id, row);
      }
    }
  }

  return byCard;
}
