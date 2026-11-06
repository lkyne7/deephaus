// FSRS scheduling logic lives in @deephaus/scheduling so web, mobile, and
// desktop can grade cards locally (offline) with identical behavior. This
// module re-exports it and keeps the server-only loading helpers.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  parseStoredWeights,
  type FsrsWeights,
  type ReviewHistoryEntry,
} from "@deephaus/scheduling";

export * from "@deephaus/scheduling";

const PARAMS_CACHE_TTL_MS = 60_000;
const weightsCache = new Map<string, { value: FsrsWeights; expiresAt: number }>();

/**
 * Load the user's personalized FSRS weights for each model. A model with no
 * fit yet (or a wrongly-shaped vector) is left out, and the scheduler falls
 * back to that model's defaults.
 */
export async function loadUserWeights(
  supabase: SupabaseClient,
  userId: string,
): Promise<FsrsWeights> {
  const cached = weightsCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const { data } = await supabase
    .from("user_fsrs_params")
    .select("params, fsrs7_params")
    .eq("user_id", userId)
    .maybeSingle();
  const value: FsrsWeights = {
    fsrs6: parseStoredWeights(data?.params).fsrs6,
    fsrs7: parseStoredWeights(data?.fsrs7_params).fsrs7,
  };
  weightsCache.set(userId, { value, expiresAt: Date.now() + PARAMS_CACHE_TTL_MS });
  return value;
}

/** Drop the cached weights after an optimization run stores new ones. */
export function clearUserWeightsCache(userId: string): void {
  weightsCache.delete(userId);
}

export function reviewHistoryKey(cardId: string, clozeOrd: number): string {
  return `${cardId}:${clozeOrd}`;
}

const HISTORY_CARD_CHUNK = 50;
const HISTORY_PAGE_SIZE = 1000;

/**
 * Recorded reviews for these cards, grouped per scheduling unit (card +
 * ordinal). The scheduler rebuilds a card's FSRS-7 memory from this history.
 *
 * A partial history must never reach the scheduler, so any failed page drops
 * the whole result: cards then continue from their stored memory state.
 */
export async function loadReviewHistories(
  supabase: SupabaseClient,
  userId: string,
  cardIds: readonly string[],
): Promise<Map<string, ReviewHistoryEntry[]>> {
  const histories = new Map<string, ReviewHistoryEntry[]>();
  const unique = [...new Set(cardIds)];
  const chunks: string[][] = [];
  for (let offset = 0; offset < unique.length; offset += HISTORY_CARD_CHUNK) {
    chunks.push(unique.slice(offset, offset + HISTORY_CARD_CHUNK));
  }

  type LogRow = {
    card_id: string;
    cloze_ord: number | null;
    rating: number;
    state: number;
    review: string;
    undone: boolean | null;
  };
  try {
    const pages = await Promise.all(
      chunks.map(async (chunk) => {
        const rows: LogRow[] = [];
        for (let from = 0; ; from += HISTORY_PAGE_SIZE) {
          const { data, error } = await supabase
            .from("review_logs")
            .select("card_id, cloze_ord, rating, state, review, undone")
            .eq("user_id", userId)
            .in("card_id", chunk)
            .order("id", { ascending: true })
            .range(from, from + HISTORY_PAGE_SIZE - 1);
          if (error) throw new Error(error.message);
          const page = (data ?? []) as LogRow[];
          rows.push(...page);
          if (page.length < HISTORY_PAGE_SIZE) return rows;
        }
      }),
    );
    for (const row of pages.flat()) {
      const key = reviewHistoryKey(row.card_id, Number(row.cloze_ord ?? 0));
      const list = histories.get(key) ?? [];
      list.push({
        rating: Number(row.rating),
        state: Number(row.state ?? 0),
        review: row.review,
        undone: row.undone,
      });
      histories.set(key, list);
    }
  } catch (error) {
    console.warn(
      "[fsrs] review history unavailable; continuing from stored memory",
      error instanceof Error ? error.message : error,
    );
    return new Map();
  }
  return histories;
}
