import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ANKI_IMPORT_JOBS_TABLE } from "@/lib/import/anki-import-jobs-server";

export const runtime = "nodejs";

/** A job that hasn't advanced in this long is treated as dead and failed. */
const STALE_PROCESSING_MS = 30 * 60 * 1000;

export const GET = withApiTiming(async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { id } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from(ANKI_IMPORT_JOBS_TABLE)
    .select(
      "id, status, phase, progress, error, result, filename, created_at, updated_at",
    )
    .eq("id", id)
    .eq("user_id", user!.id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Import job not found" }, { status: 404 });
  }

  // Safety net: a job stuck in `processing` past the stale window (e.g. the
  // serverless function was killed mid-import) is reported as failed so the
  // client stops polling forever.
  if (
    data.status === "processing" &&
    Date.now() - new Date(data.updated_at).getTime() > STALE_PROCESSING_MS
  ) {
    const message = "Import timed out or was interrupted before completing.";
    await supabase
      .from(ANKI_IMPORT_JOBS_TABLE)
      .update({ status: "failed", error: message, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", user!.id);
    return NextResponse.json({ ...data, status: "failed", error: message });
  }

  return NextResponse.json(data);
}, "GET /api/import/anki/jobs/[id]");
