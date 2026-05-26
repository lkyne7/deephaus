import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const GET = withApiTiming(async function GET(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  const jobId = new URL(request.url).searchParams.get("job_id");
  if (!jobId) {
    return NextResponse.json({ error: "job_id is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: job } = await supabase
    .from("generation_jobs")
    .select("id, sources!inner(projects!inner(user_id))")
    .eq("id", jobId)
    .eq("sources.projects.user_id", user!.id)
    .single();

  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const { data, error } = await supabase
    .from("cards")
    .select("*")
    .eq("job_id", jobId)
    .order("sort_order", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}, "GET /api/cards");
