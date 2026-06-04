import { occlusionOrdinals, parseImageOcclusionData } from "@deephaus/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cardToRowFields, emptyCard } from "@/lib/fsrs/scheduler";

/** Align per-ord review rows with enabled region cloze groups (C1–C9). */
export async function reconcileOcclusionStudyReviews(
  supabase: SupabaseClient,
  cardId: string,
  userId: string,
  occlusionData: unknown,
): Promise<void> {
  const data = parseImageOcclusionData(occlusionData);
  if (!data) return;

  const ords = occlusionOrdinals(data);
  const now = new Date();

  const { data: existing } = await supabase
    .from("card_reviews")
    .select(
      "cloze_ord, due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review, learning_steps, suspended",
    )
    .eq("card_id", cardId)
    .eq("user_id", userId);

  const byOrd = new Map((existing ?? []).map((row) => [row.cloze_ord as number, row]));
  const keepOrds = new Set(ords);
  const staleOrds = [...byOrd.keys()].filter((ord) => ord > 0 && !keepOrds.has(ord));
  if (staleOrds.length > 0) {
    await supabase
      .from("card_reviews")
      .delete()
      .eq("card_id", cardId)
      .eq("user_id", userId)
      .in("cloze_ord", staleOrds);
  }

  const template = byOrd.get(ords[0] ?? 1) ?? byOrd.get(0) ?? null;
  const baseFields = template
    ? {
        due: template.due as string,
        stability: template.stability as number,
        difficulty: template.difficulty as number,
        elapsed_days: template.elapsed_days as number,
        scheduled_days: template.scheduled_days as number,
        reps: template.reps as number,
        lapses: template.lapses as number,
        state: template.state as number,
        last_review: template.last_review as string | null,
        learning_steps: template.learning_steps as number,
        suspended: template.suspended as boolean,
      }
    : { ...cardToRowFields(emptyCard(now)), suspended: false };

  const toInsert = ords
    .filter((ord) => !byOrd.has(ord))
    .map((ord) => ({
      card_id: cardId,
      user_id: userId,
      cloze_ord: ord,
      ...baseFields,
      updated_at: now.toISOString(),
    }));

  if (toInsert.length > 0) {
    await supabase.from("card_reviews").upsert(toInsert, {
      onConflict: "card_id,user_id,cloze_ord",
    });
  }
}
