import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { enqueueGenerationJob } from "@/lib/jobs/processor";
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

  if (body.settings) {
    await supabase
      .from("projects")
      .update({ settings: body.settings, updated_at: new Date().toISOString() })
      .eq("id", source.project_id);
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

  const { data: job, error } = await supabase
    .from("generation_jobs")
    .insert({
      source_id: body.source_id,
      status: "pending",
      progress: 0,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  enqueueGenerationJob(job.id);

  return NextResponse.json(job, { status: 201 });
}
