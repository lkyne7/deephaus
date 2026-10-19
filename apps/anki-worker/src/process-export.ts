import { tmpdir } from "node:os";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ANKI_EXPORT_JOBS_TABLE,
  APKG_EXPORTS_BUCKET,
  EXPORT_TTL_MS,
  runAnkiExportJob,
  sweepExpiredExports,
  updateAnkiExportJob,
  type AnkiExportJobRow,
} from "@deephaus/anki-export";
import { resolveSupabaseAdminConfig } from "./supabase-config.js";

/** Atomically claim the next queued export, or null when the queue is empty. */
export async function claimNextExportJob(supabase: SupabaseClient): Promise<AnkiExportJobRow | null> {
  const { data, error } = await supabase.rpc("claim_anki_export_job");
  if (error) throw new Error(error.message);
  const row = data as AnkiExportJobRow | null;
  return row?.id ? row : null;
}

/**
 * Build one export on scratch disk, upload it to the private exports bucket,
 * and record where to find it. Memory stays roughly constant: images stream
 * from storage into the zip one at a time.
 */
export async function processExportJob(supabase: SupabaseClient, job: AnkiExportJobRow): Promise<void> {
  const config = resolveSupabaseAdminConfig();
  const { result, storagePath, fileSize } = await runAnkiExportJob(supabase, job, {
    scratchDir: process.env.ANKI_WORKER_TMPDIR || tmpdir(),
    supabaseUrl: config.url,
    serviceKey: config.key,
    onProgress: (progress, phase) => updateAnkiExportJob(supabase, job.id, { progress, phase }),
  });
  await updateAnkiExportJob(supabase, job.id, {
    status: "ready",
    phase: "done",
    progress: 100,
    storage_path: storagePath,
    file_size: fileSize,
    result,
    expires_at: new Date(Date.now() + EXPORT_TTL_MS).toISOString(),
  });
}

export async function failExportJob(supabase: SupabaseClient, job: AnkiExportJobRow, message: string): Promise<void> {
  await updateAnkiExportJob(supabase, job.id, { status: "failed", progress: 100, error: message });
  const storagePath = `${job.user_id}/${job.id}/${job.filename}`;
  const { error } = await supabase.storage.from(APKG_EXPORTS_BUCKET).remove([storagePath]);
  if (error && !/not found/i.test(error.message)) {
    console.warn(`[anki-worker] export cleanup failed for ${job.id}:`, error.message);
  }
}

/** Remove exports older than their TTL. Safe to call often; it is a no-op when nothing expired. */
export async function sweepExports(supabase: SupabaseClient): Promise<void> {
  try {
    const removed = await sweepExpiredExports(supabase);
    if (removed > 0) console.log(`[anki-worker] removed ${removed} expired export(s) from ${ANKI_EXPORT_JOBS_TABLE}`);
  } catch (err) {
    console.warn("[anki-worker] export sweep failed:", err instanceof Error ? err.message : err);
  }
}
