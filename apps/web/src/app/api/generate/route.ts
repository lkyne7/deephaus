import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { runGenerationJob } from "@/lib/jobs/run-generation";
import { MAX_ACTIVE_JOBS_PER_USER, isJobTerminal } from "@/lib/jobs/limits";
import { reconcileStuckJobs } from "@/lib/jobs/reconcile";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300;

export const POST = withApiTiming(async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  const body = await request.json();
  const supabase = await createClient();

  const { data: source } = await supabase
    .from("sources")
    .select("id, project_id, projects!inner(user_id)")
    .eq("id", body.source_id)
    .eq("projects.user_id", user!.id)
    .single();

  if (!source) {
    return NextResponse.json({ error: "Source not found" }, { status: 404 });
  }

  await reconcileStuckJobs(supabase, user!.id);

  const { data: activeJobs } = await supabase
    .from("generation_jobs")
    .select("id, status, sources!inner(projects!inner(user_id))")
    .eq("sources.projects.user_id", user!.id);

  const runningCount =
    activeJobs?.filter((j) => !isJobTerminal(j.status as string)).length ?? 0;

  if (runningCount >= MAX_ACTIVE_JOBS_PER_USER) {
    return NextResponse.json(
      { error: `Maximum ${MAX_ACTIVE_JOBS_PER_USER} active generation jobs allowed.` },
      { status: 429 },
    );
  }

  try {
    const { job, cards } = await runGenerationJob(supabase, body.source_id, body.settings, {
      chunkIndices: body.chunk_indices,
    });

    if (job.status === "failed") {
      return NextResponse.json({ error: job.error ?? "Generation failed", job }, { status: 422 });
    }

    return NextResponse.json({ job, cards }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation failed";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}, "POST /api/generate");
