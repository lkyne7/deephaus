import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { reconcileStuckJobs } from "@/lib/jobs/reconcile";
import { createClient } from "@/lib/supabase/server";

export const GET = withApiTiming(async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { id } = await params;
  const supabase = await createClient();

  await reconcileStuckJobs(supabase, user!.id);

  const { data, error } = await supabase
    .from("generation_jobs")
    .select("*, sources!inner(projects!inner(user_id))")
    .eq("id", id)
    .eq("sources.projects.user_id", user!.id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const { sources: _sources, ...job } = data as Record<string, unknown>;

  // Cards are saved as each chunk finishes, so this also grows during a run.
  const { count } = await supabase
    .from("cards")
    .select("id", { count: "exact", head: true })
    .eq("job_id", id);

  return NextResponse.json({ ...job, card_count: count ?? 0 });
}, "GET /api/jobs/[id]");
