import { tmpdir } from "node:os";
import { NextResponse, after } from "next/server";
import {
  EXPORT_TTL_MS,
  countExportCards,
  exportFilename,
  exportHasMedia,
  resolveExportTarget,
  runAnkiExportJob,
} from "@deephaus/anki-export";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  ANKI_EXPORT_JOBS_TABLE,
  exportServiceCredentials,
  updateAnkiExportJob,
} from "@/lib/export/anki-export-jobs-server";

export const maxDuration = 300;

/**
 * Decks without images up to this many cards are packaged inline (via
 * `after()`), so they finish even when no worker is deployed. Anything with
 * media is left queued for the worker, which streams images to scratch disk;
 * a function's /tmp and memory cannot hold a large media deck.
 */
const INLINE_MAX_CARDS = Number(process.env.ANKI_EXPORT_INLINE_MAX_CARDS) || 20_000;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

type EnqueueBody = {
  project_id?: string;
  job_id?: string;
  include_progress?: boolean;
};

/**
 * Start an asynchronous .apkg export of a deck (or one generation job).
 *
 *   POST /api/export/enqueue   { "project_id": "…", "job_id"?: "…", "include_progress"?: true }
 *   → 202 { jobId, inline, filename }
 *
 * Poll GET /api/export/jobs/[id]; when ready, GET /api/export/jobs/[id]/download
 * returns a signed URL the browser downloads with its own progress UI.
 */
export const POST = withApiTiming(async function POST(request: Request) {
  const { user, response } = await requireUser({ rateLimit: "costly" });
  if (response) return response;

  let body: EnqueueBody;
  try {
    body = (await request.json()) as EnqueueBody;
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }
  const projectId = typeof body.project_id === "string" ? body.project_id.trim() : "";
  if (!projectId) return jsonError("project_id is required", 400);
  const generationJobId = typeof body.job_id === "string" && body.job_id.trim() ? body.job_id.trim() : null;
  const includeProgress = body.include_progress !== false;

  const supabase = await createClient();
  const target = await resolveExportTarget(supabase, user!.id, projectId, generationJobId);
  if (!target) return jsonError(generationJobId ? "Job not found" : "Project not found", 404);

  let cardCount: number;
  let hasMedia: boolean;
  try {
    [cardCount, hasMedia] = await Promise.all([
      countExportCards(supabase, target.jobIds),
      exportHasMedia(supabase, target.jobIds),
    ]);
  } catch (error) {
    return jsonError((error as Error).message, 500);
  }
  if (cardCount === 0) return jsonError("No cards to export", 400);

  const canRunInline = !hasMedia && cardCount <= INLINE_MAX_CARDS;
  const filename = exportFilename(target.deckName);

  // Inline jobs start out "processing" so a running worker never claims one
  // the function is about to handle in after().
  const { data: job, error } = await supabase
    .from(ANKI_EXPORT_JOBS_TABLE)
    .insert({
      user_id: user!.id,
      project_id: projectId,
      generation_job_id: generationJobId,
      include_progress: includeProgress,
      filename,
      status: canRunInline ? "processing" : "pending",
      phase: canRunInline ? "loading" : null,
      progress: canRunInline ? 3 : 0,
    })
    .select("id")
    .single();
  if (error || !job) {
    console.error("[POST /api/export/enqueue] insert failed", error);
    return jsonError("Could not start the export.", 500);
  }
  const jobId = job.id as string;

  if (canRunInline) {
    const userId = user!.id;
    after(async () => {
      const service = createServiceClient();
      try {
        const { supabaseUrl, serviceKey } = exportServiceCredentials();
        const outcome = await runAnkiExportJob(
          service,
          { id: jobId, user_id: userId, project_id: projectId, generation_job_id: generationJobId, include_progress: includeProgress, filename },
          {
            scratchDir: tmpdir(),
            supabaseUrl,
            serviceKey,
            onProgress: (progress, phase) => updateAnkiExportJob(service, jobId, { progress, phase }),
          },
        );
        await updateAnkiExportJob(service, jobId, {
          status: "ready",
          phase: "done",
          progress: 100,
          storage_path: outcome.storagePath,
          file_size: outcome.fileSize,
          result: outcome.result,
          expires_at: new Date(Date.now() + EXPORT_TTL_MS).toISOString(),
        });
      } catch (err) {
        console.error("[anki-export inline] failed", err);
        await updateAnkiExportJob(service, jobId, {
          status: "failed",
          progress: 100,
          error: err instanceof Error ? err.message : "Export failed.",
        });
      }
    });
  }

  return NextResponse.json({ jobId, inline: canRunInline, filename }, { status: 202 });
}, "POST /api/export/enqueue");
