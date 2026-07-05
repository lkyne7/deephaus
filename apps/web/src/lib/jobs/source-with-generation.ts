import {
  generationSettingsPartialSchema,
  mergeGenerationSettingsPatch,
  type GenerationSettings,
} from "@deephaus/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { MAX_ACTIVE_JOBS_PER_USER, isJobTerminal } from "@/lib/jobs/limits";
import { runGenerationJob } from "@/lib/jobs/run-generation";
import { reconcileStuckJobs } from "@/lib/jobs/reconcile";

export type SourceGenerationOptions = {
  settings?: Partial<GenerationSettings>;
  chunkIndices?: number[];
};

export class GenerationCapacityError extends Error {
  constructor() {
    super(`Maximum ${MAX_ACTIVE_JOBS_PER_USER} active generation jobs allowed.`);
    this.name = "GenerationCapacityError";
  }
}

export async function assertCanStartGeneration(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  await reconcileStuckJobs(supabase, userId);
  const { data: activeJobs } = await supabase
    .from("generation_jobs")
    .select("id, status, sources!inner(projects!inner(user_id))")
    .eq("sources.projects.user_id", userId);

  const runningCount =
    activeJobs?.filter((job) => !isJobTerminal(job.status as string)).length ?? 0;

  if (runningCount >= MAX_ACTIVE_JOBS_PER_USER) {
    throw new GenerationCapacityError();
  }
}

export function parseGenerationOptionsFromForm(form: FormData): {
  generate: boolean;
  options: SourceGenerationOptions;
} {
  const generate = form.get("generate") === "true";
  const settingsRaw = form.get("settings");
  let settings: Partial<GenerationSettings> | undefined;
  if (typeof settingsRaw === "string" && settingsRaw.trim()) {
    settings = mergeGenerationSettingsPatch(
      generationSettingsPartialSchema.parse(JSON.parse(settingsRaw)),
    );
  }

  const chunkRaw = form.get("chunk_indices");
  let chunkIndices: number[] | undefined;
  if (typeof chunkRaw === "string" && chunkRaw.trim()) {
    chunkIndices = z.array(z.number().int().min(0)).parse(JSON.parse(chunkRaw));
  }

  return { generate, options: { settings, chunkIndices } };
}

const jsonGenerationBodySchema = z.object({
  generate: z.boolean().optional(),
  settings: generationSettingsPartialSchema.optional(),
  chunk_indices: z.array(z.number().int().min(0)).optional(),
});

export function parseGenerationOptionsFromJson(body: Record<string, unknown>): {
  generate: boolean;
  options: SourceGenerationOptions;
} {
  const parsed = jsonGenerationBodySchema.parse(body);
  return {
    generate: parsed.generate === true,
    options: {
      settings: parsed.settings
        ? mergeGenerationSettingsPatch(parsed.settings)
        : undefined,
      chunkIndices: parsed.chunk_indices,
    },
  };
}

export async function runSourceGeneration(
  supabase: SupabaseClient,
  userId: string,
  sourceId: string,
  options: SourceGenerationOptions,
) {
  await assertCanStartGeneration(supabase, userId);
  const { job, cards } = await runGenerationJob(supabase, sourceId, options.settings, {
    chunkIndices: options.chunkIndices,
  });
  if (job.status === "failed") {
    throw new Error(job.error ?? "Generation failed");
  }
  return { job, cards };
}
