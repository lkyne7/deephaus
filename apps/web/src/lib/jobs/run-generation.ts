import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";
import { formatTopicSourceText, type GenerationSettings } from "@deephaus/shared";
import { processGenerationJob } from "@/lib/jobs/processor";
import { createServiceClient } from "@/lib/supabase/server";

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

export async function createTopicSource(
  supabase: SupabaseClient,
  projectId: string,
  topic: string,
) {
  const trimmed = topic.trim();
  if (!trimmed) {
    throw new Error("Topic is required");
  }
  if (trimmed.length < 3) {
    throw new Error("Topic is too short (minimum 3 characters).");
  }

  const { data, error } = await supabase
    .from("sources")
    .insert({
      project_id: projectId,
      type: "topic",
      raw_text: trimmed,
    })
    .select()
    .single();

  if (error?.message?.includes("sources_type_check")) {
    const fallback = await supabase
      .from("sources")
      .insert({
        project_id: projectId,
        type: "text",
        raw_text: formatTopicSourceText(trimmed),
      })
      .select()
      .single();
    if (fallback.error) throw new Error(fallback.error.message);
    return fallback.data;
  }

  if (error) throw new Error(error.message);
  return data;
}

type GenerationRunOptions = {
  chunkIndices?: number[];
  scopeText?: string;
  /**
   * When true, insert the job and process it via `after()` so the HTTP response
   * can return immediately and the client can poll live progress. Prefer this
   * for interactive UI flows.
   */
  async?: boolean;
};

async function insertGenerationJob(
  supabase: SupabaseClient,
  sourceId: string,
  settings?: Partial<GenerationSettings>,
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
  return job;
}

/**
 * Create a generation job and process it. With `{ async: true }` the job is
 * processed in the background (Next.js `after`) and this returns immediately
 * with `cards: []` so the client can poll `/api/jobs/:id` for progress.
 */
export async function runGenerationJob(
  supabase: SupabaseClient,
  sourceId: string,
  settings?: Partial<GenerationSettings>,
  options?: GenerationRunOptions,
) {
  const job = await insertGenerationJob(supabase, sourceId, settings);
  const processOptions = {
    chunkIndices: options?.chunkIndices,
    scopeText: options?.scopeText,
  };

  if (options?.async) {
    const jobId = job.id as string;
    after(async () => {
      const service = createServiceClient();
      try {
        await processGenerationJob(jobId, service, processOptions);
      } catch (err) {
        console.error("[generation after()] failed", err);
        await service
          .from("generation_jobs")
          .update({
            status: "failed",
            progress: 100,
            error: err instanceof Error ? err.message : "Generation failed",
            updated_at: new Date().toISOString(),
          })
          .eq("id", jobId);
      }
    });
    return { job, cards: [] as unknown[] };
  }

  await processGenerationJob(job.id, supabase, processOptions);

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
