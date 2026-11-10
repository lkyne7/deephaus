import type { SupabaseClient } from "@supabase/supabase-js";

/** How one card is doing for one learner, across all of its cloze or image parts. */
export type CardStats = {
  /** Times the card has been graded, summed over its parts. */
  reps: number;
  /** The earliest date any studied part is due; null before the first review. */
  due: string | null;
  /** The most recent grade: 1 Again, 2 Hard, 3 Good, 4 Easy. */
  last_rating: number | null;
  last_reviewed: string | null;
};

export function cardStatsKey(cardId: string): string {
  return `/api/cards/${cardId}/stats`;
}

const GRADES: Record<number, string> = { 1: "Again", 2: "Hard", 3: "Good", 4: "Easy" };

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function dueLabel(due: string, now: Date): string {
  const days = Math.round((startOfDay(new Date(due)) - startOfDay(now)) / 86_400_000);
  if (days < -1) return `Overdue by ${-days} days`;
  if (days === -1) return "Overdue by a day";
  if (days === 0) return "Due today";
  if (days === 1) return "Next due tomorrow";
  return `Next due in ${days.toLocaleString()} days`;
}

/** "Next due in 3 days · 2 reviews · last graded Good", for the card editor. */
export function scheduleLine(stats: CardStats, suspended: boolean, now = new Date()): string {
  if (stats.reps === 0) return suspended ? "Suspended · not studied yet" : "New · not studied yet";
  return [
    suspended ? "Suspended" : stats.due ? dueLabel(stats.due, now) : null,
    `${stats.reps.toLocaleString()} ${stats.reps === 1 ? "review" : "reviews"}`,
    stats.last_rating && GRADES[stats.last_rating] ? `last graded ${GRADES[stats.last_rating]}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Null when the card isn't the user's. */
export async function loadCardStats(
  supabase: SupabaseClient,
  userId: string,
  cardId: string,
): Promise<CardStats | null> {
  const { data: card } = await supabase
    .from("cards")
    .select("id, generation_jobs!inner(sources!inner(projects!inner(user_id)))")
    .eq("id", cardId)
    .eq("generation_jobs.sources.projects.user_id", userId)
    .maybeSingle();
  if (!card) return null;

  const [{ data: reviews }, { data: lastLog }] = await Promise.all([
    supabase.from("card_reviews").select("due, reps").eq("card_id", cardId).eq("user_id", userId),
    supabase
      .from("review_logs")
      .select("rating, review")
      .eq("card_id", cardId)
      .eq("user_id", userId)
      .order("review", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  // A part that has never been graded has a placeholder due date; leave it out.
  const studied = (reviews ?? []).filter((row) => Number(row.reps) > 0);
  const dueTimes = studied.map((row) => Date.parse(row.due as string)).filter(Number.isFinite);

  return {
    reps: studied.reduce((sum, row) => sum + Number(row.reps), 0),
    due: dueTimes.length > 0 ? new Date(Math.min(...dueTimes)).toISOString() : null,
    last_rating: lastLog ? Number(lastLog.rating) : null,
    last_reviewed: (lastLog?.review as string | undefined) ?? null,
  };
}
