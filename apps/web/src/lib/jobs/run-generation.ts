import type { SupabaseClient } from "@supabase/supabase-js";
import type { GenerationSettings } from "@deephaus/shared";
import { processGenerationJob } from "@/lib/jobs/processor";

export async function createTextSource(
  supabase: SupabaseClient,
  projectId: string,
  text: string,
) {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("Text is required");
  }
  if (trimmed.length < 20) {
    throw new Error("Text is too short to generate useful flashcards (minimum 20 characters).");
  }

  const { data, error } = await supabase
    .from("sources")
    .insert({
      project_id: projectId,
      type: "text",
      raw_text: trimmed,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function runGenerationJob(
  supabase: SupabaseClient,
  sourceId: string,
  settings?: Partial<GenerationSettings>,
  options?: { chunkIndices?: number[] },
) {
  const { data: source } = await supabase
    .from("sources")
    .select("id, project_id")
    .eq("id", sourceId)
    .single();

  if (!source) throw new Error("Source not found");

  if (settings) {
    await supabase
      .from("projects")
      .update({ settings, updated_at: new Date().toISOString() })
      .eq("id", source.project_id);
  }

  const { data: job, error } = await supabase
    .from("generation_jobs")
    .insert({
      source_id: sourceId,
      status: "pending",
      progress: 0,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  await processGenerationJob(job.id, supabase, options);

  const { data: updatedJob } = await supabase
    .from("generation_jobs")
    .select()
    .eq("id", job.id)
    .single();

  const finalJob = updatedJob ?? job;

  const { data: cards } = await supabase
    .from("cards")
    .select("*")
    .eq("job_id", finalJob.id)
    .order("sort_order", { ascending: true });

  return { job: finalJob, cards: cards ?? [] };
}
