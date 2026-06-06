import { NextResponse, after } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { assertApkgStoragePathOwned } from "@/lib/import/apkg-import-constants";
import { removeApkgImportObject } from "@/lib/import/apkg-storage-server";
import { runApkgImportFromStorage } from "@/lib/import/import-runner";
import {
  ANKI_IMPORT_JOBS_TABLE,
  updateAnkiImportJob,
} from "@/lib/import/anki-import-jobs-server";

export const maxDuration = 300;
export const runtime = "nodejs";

/**
 * Packages at or below this size are imported inline (via `after()`) so they
 * complete even when no worker is deployed. Larger packages are left queued for
 * the standalone worker, which streams multi-GB archives without buffering.
 */
const INLINE_MAX_BYTES =
  (Number(process.env.ANKI_INLINE_MAX_MB) || 80) * 1024 * 1024;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

type EnqueueBody = {
  storage_path?: string;
  filename?: string;
  file_size?: number;
  deck_name?: string;
  scheduling?: boolean;
};

export const POST = withApiTiming(async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  let body: EnqueueBody;
  try {
    body = (await request.json()) as EnqueueBody;
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  const storagePath = body.storage_path?.trim();
  if (!storagePath) return jsonError("storage_path is required.", 400);

  try {
    assertApkgStoragePathOwned(user!.id, storagePath);
  } catch {
    return jsonError("Invalid import path.", 400);
  }

  const deckNameOverride = body.deck_name?.trim() || undefined;
  const importScheduling = body.scheduling !== false;
  const fileSize = typeof body.file_size === "number" ? body.file_size : null;
  const canRunInline = fileSize != null && fileSize <= INLINE_MAX_BYTES;

  const supabase = await createClient();
  // Inline jobs are inserted already "processing" so a running worker (which
  // only claims "pending" jobs) can never grab one we're about to handle via
  // after(). Larger jobs stay "pending" for the worker to pick up.
  const { data: job, error } = await supabase
    .from(ANKI_IMPORT_JOBS_TABLE)
    .insert({
      user_id: user!.id,
      storage_path: storagePath,
      filename: body.filename?.slice(0, 200) ?? null,
      file_size: fileSize,
      status: canRunInline ? "processing" : "pending",
      phase: canRunInline ? "importing" : null,
      progress: canRunInline ? 8 : 0,
      scheduling: importScheduling,
      deck_name_override: deckNameOverride ?? null,
    })
    .select("id")
    .single();

  if (error || !job) {
    console.error("[POST /api/import/anki/enqueue] insert failed", error);
    return jsonError("Could not start the import.", 500);
  }

  if (canRunInline) {
    const jobId = job.id as string;
    const userId = user!.id;
    after(async () => {
      const service = createServiceClient();
      try {
        await updateAnkiImportJob(service, jobId, {
          status: "processing",
          phase: "importing",
          progress: 8,
        });
        const result = await runApkgImportFromStorage(service, userId, storagePath, {
          deckNameOverride,
          importScheduling,
          onProgress: (progress, phase) =>
            updateAnkiImportJob(service, jobId, { progress, phase }),
        });
        await updateAnkiImportJob(service, jobId, {
          status: "ready",
          phase: "done",
          progress: 100,
          result,
        });
        await removeApkgImportObject(service, storagePath);
      } catch (err) {
        console.error("[anki-import inline] failed", err);
        await updateAnkiImportJob(service, jobId, {
          status: "failed",
          progress: 100,
          error: err instanceof Error ? err.message : "Import failed.",
        });
        await removeApkgImportObject(service, storagePath).catch(() => {});
      }
    });
  }

  return NextResponse.json(
    { jobId: job.id, inline: canRunInline },
    { status: 202 },
  );
}, "POST /api/import/anki/enqueue");
