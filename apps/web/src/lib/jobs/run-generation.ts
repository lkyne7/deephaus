import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";
import {
  MAX_CARDS_PER_JOB,
  formatTopicSourceText,
  isTopicSource,
  parseGenerationSettings,
  type GenerationSettings,
} from "@deephaus/shared";
import {
  releaseAiCredits,
  reserveAiCredits,
} from "@/lib/credits/service";
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

const TOPIC_CREDITS = { low: 8, medium: 15, high: 25 } as const;
const SOURCE_CREDITS_PER_1K_WORDS = { low: 2, medium: 5, high: 10 } as const;

export function estimateGenerationCredits(input: {
  source: { type: string; raw_text?: string | null };
  settings: GenerationSettings;
  scopeText?: string;
}): number {
  if (isTopicSource(input.source)) {
    return TOPIC_CREDITS[input.settings.detailLevel];
  }

  const text = input.scopeText?.trim() || input.source.raw_text?.trim() || "";
  const words = text ? text.split(/\s+/).length : 0;
  const estimated = Math.max(
    1,
    Math.ceil(
      (words / 1000) * SOURCE_CREDITS_PER_1K_WORDS[input.settings.detailLevel],
    ),
  );
  return Math.min(MAX_CARDS_PER_JOB, estimated);
}

function firstRelated<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

async function insertGenerationJob(
  supabase: SupabaseClient,
  sourceId: string,
  settings?: Partial<GenerationSettings>,
  options?: Pick<GenerationRunOptions, "scopeText">,
) {
  const { data: source, error: sourceError } = await supabase
    .from("sources")
    .select("id, project_id, type, raw_text, projects!inner(user_id, settings)")
    .eq("id", sourceId)
    .single();

  if (sourceError || !source) throw new Error("Source not found");

  const project = firstRelated(
    source.projects as
      | { user_id: string; settings: unknown }
      | Array<{ user_id: string; settings: unknown }>
      | null,
  );
  if (!project) throw new Error("Source owner not found");

  const resolvedSettings = parseGenerationSettings({
    ...((project.settings as Record<string, unknown> | null) ?? {}),
    ...(settings ?? {}),
  });

  if (settings) {
    const { error: settingsError } = await supabase
      .from("projects")
      .update({ settings: resolvedSettings, updated_at: new Date().toISOString() })
      .eq("id", source.project_id);
    if (settingsError) throw new Error(settingsError.message);
  }

  const jobId = crypto.randomUUID();
  const idempotencyKey = `generation:${jobId}`;
  const mock =
    process.env.DEEPHAUS_USE_MOCK_LLM === "true" || !process.env.OPENAI_API_KEY;
  const reservedCredits = estimateGenerationCredits({
    source,
    settings: resolvedSettings,
    scopeText: options?.scopeText,
  });

  const creditTransaction = mock
    ? null
    : await reserveAiCredits({
        userId: project.user_id,
        idempotencyKey,
        action: "generation",
        reservedCredits,
        resourceType: "generation_job",
        resourceId: jobId,
        metadata: {
          source_id: sourceId,
          detail_level: resolvedSettings.detailLevel,
        },
      });

  const { data: job, error } = await supabase
    .from("generation_jobs")
    .insert({
      id: jobId,
      source_id: sourceId,
      status: "pending",
      progress: 0,
    })
    .select()
    .single();

  if (error) {
    if (creditTransaction) {
      await releaseAiCredits({
        userId: project.user_id,
        idempotencyKey,
      });
    }
    throw new Error(error.message);
  }
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
  const job = await insertGenerationJob(supabase, sourceId, settings, options);
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
