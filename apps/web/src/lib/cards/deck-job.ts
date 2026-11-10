import type { SupabaseClient } from "@supabase/supabase-js";

export type DeckJob = { jobId: string } | { error: string };

/**
 * The generation job a card joins when it is added to a deck by hand or moved
 * into it. A card belongs to a deck through its job, so every deck needs one:
 * the most recent job is reused, and a deck with none gets an empty text source
 * and a finished job. With `sourceId`, only that source's jobs are considered,
 * which keeps a card with the source it was made from.
 */
export async function findOrCreateDeckJob(
  supabase: SupabaseClient,
  projectId: string,
  sourceId: string | null = null,
): Promise<DeckJob> {
  let jobQuery = supabase.from("generation_jobs").select("id, sources!inner(project_id)");
  jobQuery = sourceId
    ? jobQuery.eq("source_id", sourceId)
    : jobQuery.eq("sources.project_id", projectId);
  const { data: jobRow } = await jobQuery
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const existing = (jobRow as { id?: string } | null)?.id;
  if (existing) return { jobId: existing };

  let jobSourceId = sourceId;
  if (!jobSourceId) {
    const { data: source, error: sourceError } = await supabase
      .from("sources")
      .insert({ project_id: projectId, type: "text", raw_text: "" })
      .select("id")
      .single();
    if (sourceError || !source) return { error: sourceError?.message ?? "Could not create source" };
    jobSourceId = source.id as string;
  }

  const { data: job, error: jobError } = await supabase
    .from("generation_jobs")
    .insert({ source_id: jobSourceId, status: "ready", progress: 100 })
    .select("id")
    .single();
  if (jobError || !job) return { error: jobError?.message ?? "Could not create job" };
  return { jobId: job.id as string };
}
