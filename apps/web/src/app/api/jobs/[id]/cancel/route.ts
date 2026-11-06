import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { isJobTerminal } from "@/lib/jobs/limits";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/jobs/:id/cancel — ask a running generation to stop. The processor
 * sees the request before its next save, keeps the cards saved so far, and
 * settles credits for those alone.
 */
export const POST = withApiTiming(async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { id } = await params;
  const supabase = await createClient();

  const { data: job } = await supabase
    .from("generation_jobs")
    .select("id, status, sources!inner(projects!inner(user_id))")
    .eq("id", id)
    .eq("sources.projects.user_id", user!.id)
    .single();

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  if (!isJobTerminal(job.status as string)) {
    const { error } = await supabase
      .from("generation_jobs")
      .update({ cancel_requested_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { count } = await supabase
    .from("cards")
    .select("id", { count: "exact", head: true })
    .eq("job_id", id);

  return NextResponse.json({ card_count: count ?? 0 });
}, "POST /api/jobs/[id]/cancel");
