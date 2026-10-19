import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  ANKI_EXPORT_JOBS_TABLE,
  EXPORT_DOWNLOAD_URL_TTL_SECONDS,
  createExportDownloadUrl,
} from "@/lib/export/anki-export-jobs-server";

/**
 * A signed URL for a finished export. The file is served by storage, so the
 * browser (or the mobile download task) shows progress and nothing passes
 * through a function's memory or response body.
 */
export const GET = withApiTiming(async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { id } = await params;
  const supabase = await createClient();
  const { data: job } = await supabase
    .from(ANKI_EXPORT_JOBS_TABLE)
    .select("status, storage_path, filename, file_size, expires_at")
    .eq("id", id)
    .eq("user_id", user!.id)
    .maybeSingle();
  if (!job) return NextResponse.json({ error: "Export job not found" }, { status: 404 });

  const expired =
    job.status === "expired" ||
    (job.expires_at != null && new Date(job.expires_at).getTime() <= Date.now());
  if (expired) {
    return NextResponse.json({ error: "This export has expired. Export the deck again." }, { status: 410 });
  }
  if (job.status !== "ready" || !job.storage_path) {
    return NextResponse.json({ error: "Export is not ready yet." }, { status: 409 });
  }

  try {
    const url = await createExportDownloadUrl(createServiceClient(), job.storage_path, job.filename);
    return NextResponse.json({
      url,
      filename: job.filename,
      size: job.file_size,
      urlExpiresAt: new Date(Date.now() + EXPORT_DOWNLOAD_URL_TTL_SECONDS * 1000).toISOString(),
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}, "GET /api/export/jobs/[id]/download");
