import type { SupabaseClient } from "@supabase/supabase-js";
import { countUsableTrainingItems, type TrainingLogRow } from "@/lib/fsrs/training-items";

/** Match the optimizer's own MAX_LOGS ceiling so the readiness count agrees. */
const MAX_LOGS = 50_000;

export interface OptimizerReadiness {
  /** Total review-log rows scanned (bounded by MAX_LOGS). */
  totalLogs: number;
  /** Reviews usable for training — cards reviewed across at least one real day gap. */
  usableItems: number;
}

/**
 * Compute how much of the user's review history the FSRS optimizer can actually
 * train on. This mirrors the optimizer's grouping/interval logic exactly (via
 * the shared training-items builder) so the profile meter never disagrees with
 * the real optimize gate.
 */
export async function getOptimizerReadiness(
  supabase: SupabaseClient,
  userId: string,
): Promise<OptimizerReadiness> {
  const { data, error } = await supabase
    .from("review_logs")
    .select("card_id, cloze_ord, rating, review")
    .eq("user_id", userId)
    .order("review", { ascending: true })
    .limit(MAX_LOGS);

  if (error) {
    console.warn("[getOptimizerReadiness]", error.message);
    return { totalLogs: 0, usableItems: 0 };
  }

  const rows = (data ?? []) as TrainingLogRow[];
  return { totalLogs: rows.length, usableItems: countUsableTrainingItems(rows) };
}
