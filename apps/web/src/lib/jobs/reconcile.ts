import type { SupabaseClient } from "@supabase/supabase-js";
import { releaseAiCredits } from "@/lib/credits/service";
import { isJobTerminal } from "@/lib/jobs/limits";

/** Jobs non-terminal for longer than this are marked failed. */
const STALE_JOB_MS = 15 * 60 * 1000;

/**
 * Repair generation jobs left in a non-terminal state (e.g. serverless timeout or
 * a progress-update race overwriting a failed status).
 */
export async function reconcileStuckJobs(
  supabase: SupabaseClient,
  userId: string,
): Promise<number> {
  const staleBefore = new Date(Date.now() - STALE_JOB_MS).toISOString();

  const { data: jobs } = await supabase
    .from("generation_jobs")
    .select(
      "id, status, error, updated_at, credit_transaction_id, sources!inner(projects!inner(user_id))",
    )
    .eq("sources.projects.user_id", userId);

  const stuck =
    jobs?.filter((job) => {
      if (isJobTerminal(job.status as string)) return false;
      if (job.error) return true;
      return job.updated_at < staleBefore;
    }) ?? [];

  if (stuck.length === 0) return 0;

  const now = new Date().toISOString();
  await Promise.all(
    stuck.map(async (job) => {
      const { error } = await supabase
        .from("generation_jobs")
        .update({
          status: "failed",
          progress: 100,
          error:
            (job.error as string | null) ??
            "Generation timed out or was interrupted before completing.",
          updated_at: now,
        })
        .eq("id", job.id);
      if (!error && job.credit_transaction_id) {
        await releaseAiCredits({
          userId,
          idempotencyKey: `generation:${job.id}`,
        });
      }
    }),
  );

  return stuck.length;
}
