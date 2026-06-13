import type { SupabaseClient } from "@supabase/supabase-js";

/** O(1) review log total from maintained counter (falls back to count on first load). */
export async function getUserReviewLogCount(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from("user_stats")
    .select("review_log_count")
    .eq("user_id", userId)
    .maybeSingle();

  if (!error && data) {
    return Number(data.review_log_count ?? 0);
  }

  const { count, error: countError } = await supabase
    .from("review_logs")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);

  if (countError) {
    console.warn("[getUserReviewLogCount]", countError.message);
    return 0;
  }

  return count ?? 0;
}
