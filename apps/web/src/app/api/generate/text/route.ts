import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { z } from "zod";
import { generationSettingsPartialSchema } from "@deephaus/shared";
import { requireUser } from "@/lib/auth";
import { MAX_ACTIVE_JOBS_PER_USER, isJobTerminal } from "@/lib/jobs/limits";
import { createTextSource, runGenerationJob } from "@/lib/jobs/run-generation";
import { reconcileStuckJobs } from "@/lib/jobs/reconcile";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300;

const bodySchema = z.object({
  project_id: z.string().uuid(),
  text: z.string().min(1),
  settings: generationSettingsPartialSchema.optional(),
  chunk_indices: z.array(z.number().int().min(0)).optional(),
});

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * One-shot API: paste text → generate flashcards → return job + cards.
 *
 * POST /api/generate/text
 * Body: { project_id, text, settings? }
 */
export const POST = withApiTiming(async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch (error) {
    const message = error instanceof z.ZodError ? error.errors[0]?.message : "Invalid request body";
    return jsonError(message ?? "Invalid request body", 400);
  }

  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", body.project_id)
    .eq("user_id", user!.id)
    .single();

  if (!project) {
    return jsonError("Project not found", 404);
  }

  await reconcileStuckJobs(supabase, user!.id);

  const { data: activeJobs } = await supabase
    .from("generation_jobs")
    .select("id, status, sources!inner(projects!inner(user_id))")
    .eq("sources.projects.user_id", user!.id);

  const runningCount =
    activeJobs?.filter((j) => !isJobTerminal(j.status as string)).length ?? 0;

  if (runningCount >= MAX_ACTIVE_JOBS_PER_USER) {
    return jsonError(
      `Maximum ${MAX_ACTIVE_JOBS_PER_USER} active generation jobs allowed.`,
      429,
    );
  }

  try {
    const source = await createTextSource(supabase, body.project_id, body.text);
    const { job, cards } = await runGenerationJob(
      supabase,
      source.id,
      body.settings,
      {
        chunkIndices: body.chunk_indices,
      },
    );

    if (job.status === "failed") {
      return jsonError(job.error ?? "Generation failed", 422);
    }

    return NextResponse.json(
      {
        source,
        job,
        cards,
        mock: process.env.DEEPHAUS_USE_MOCK_LLM === "true" || !process.env.OPENAI_API_KEY,
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation failed";
    return jsonError(message, 422);
  }
}, "POST /api/generate/text");
