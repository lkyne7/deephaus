import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { runGenerationJob } from "@/lib/jobs/run-generation";
import { MAX_ACTIVE_JOBS_PER_USER, isJobTerminal } from "@/lib/jobs/limits";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
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
    const { job, cards } = await runGenerationJob(supabase, body.source_id, body.settings);
    return NextResponse.json({ job, cards }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation failed";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
