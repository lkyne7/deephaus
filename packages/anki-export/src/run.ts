import { randomUUID } from "node:crypto";
import { mkdir, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { writeApkgStream, type StreamExportResult } from "./build.js";
import { loadExportCards, loadExportProgress, resolveExportTarget } from "./data.js";
import { uploadExportFile } from "./upload.js";

export const APKG_EXPORTS_BUCKET = "apkg-exports";
export const ANKI_EXPORT_JOBS_TABLE = "anki_export_jobs";
/** Finished exports are kept this long before the worker removes them. */
export const EXPORT_TTL_MS = 24 * 60 * 60 * 1000;

export type AnkiExportJobStatus = "pending" | "processing" | "ready" | "failed" | "expired";
export type AnkiExportPhase = "starting" | "loading" | "media" | "packaging" | "uploading" | "done";

export type AnkiExportResult = StreamExportResult;

export type AnkiExportJobRow = {
  id: string;
  user_id: string;
  project_id: string;
  generation_job_id: string | null;
  include_progress: boolean;
  filename: string;
  status: AnkiExportJobStatus;
  phase: string | null;
  progress: number;
  storage_path: string | null;
  file_size: number | null;
  result: AnkiExportResult | null;
  error: string | null;
  attempts: number;
  claimed_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AnkiExportJobPatch = Partial<
  Pick<AnkiExportJobRow, "status" | "phase" | "progress" | "storage_path" | "file_size" | "result" | "error" | "expires_at">
>;

/** A download filename for a deck, e.g. "Cardiology.apkg". */
export function exportFilename(deckName: string): string {
  return `${deckName.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "") || "deck"}.apkg`;
}

export function exportStoragePath(userId: string, jobId: string, filename: string): string {
  return `${userId}/${jobId}/${filename}`;
}

export async function updateAnkiExportJob(
  supabase: SupabaseClient,
  id: string,
  patch: AnkiExportJobPatch,
): Promise<void> {
  const { error } = await supabase
    .from(ANKI_EXPORT_JOBS_TABLE)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) console.warn(`[anki-export] failed to update job ${id}:`, error.message);
}

export interface RunExportOptions {
  /** Directory for the package while it is built; needs room for the whole file. */
  scratchDir: string;
  supabaseUrl: string;
  serviceKey: string;
  onProgress?: (progress: number, phase: AnkiExportPhase) => void | Promise<void>;
}

export interface RunExportOutcome {
  result: AnkiExportResult;
  storagePath: string;
  fileSize: number;
}

// Progress bands for each phase of the job (0–100).
const LOADING_END = 12;
const MEDIA_END = 72;
const PACKAGING_END = 76;
const UPLOAD_END = 98;

/**
 * Build a job's package on disk, upload it to the private exports bucket and
 * remove the scratch file. Shared by the worker and the web app's inline path.
 */
export async function runAnkiExportJob(
  supabase: SupabaseClient,
  job: Pick<AnkiExportJobRow, "id" | "user_id" | "project_id" | "generation_job_id" | "include_progress" | "filename">,
  options: RunExportOptions,
): Promise<RunExportOutcome> {
  const report = (progress: number, phase: AnkiExportPhase) =>
    options.onProgress?.(Math.round(progress), phase);

  await report(3, "loading");
  const target = await resolveExportTarget(supabase, job.user_id, job.project_id, job.generation_job_id);
  if (!target) throw new Error("Deck not found.");
  const cards = await loadExportCards(supabase, target.jobIds);
  if (cards.length === 0) throw new Error("No cards to export.");
  const progress = job.include_progress
    ? await loadExportProgress(supabase, job.user_id, cards.map((card) => card.id))
    : undefined;
  await report(LOADING_END, "loading");

  await mkdir(options.scratchDir, { recursive: true });
  const outputPath = join(options.scratchDir, `anki-export-${randomUUID()}.apkg`);
  try {
    const result = await writeApkgStream({
      deckName: target.deckName,
      cards,
      progress,
      outputPath,
      description: "Exported from DeepHaus",
      onProgress: ({ phase, done, total }) => {
        const frac = total > 0 ? done / total : 1;
        return phase === "media"
          ? report(LOADING_END + frac * (MEDIA_END - LOADING_END), "media")
          : report(MEDIA_END + frac * (PACKAGING_END - MEDIA_END), "packaging");
      },
    });

    const fileSize = (await stat(outputPath)).size;
    const storagePath = exportStoragePath(job.user_id, job.id, job.filename);
    let lastReported = 0;
    await uploadExportFile({
      supabaseUrl: options.supabaseUrl,
      serviceKey: options.serviceKey,
      bucket: APKG_EXPORTS_BUCKET,
      objectName: storagePath,
      filePath: outputPath,
      size: fileSize,
      onProgress: (sent, total) => {
        // Cap job updates to roughly one per percent.
        const value = PACKAGING_END + (total > 0 ? sent / total : 1) * (UPLOAD_END - PACKAGING_END);
        if (value - lastReported >= 1 || sent === total) {
          lastReported = value;
          return report(value, "uploading");
        }
      },
    });

    return { result: { ...result, bytes: fileSize }, storagePath, fileSize };
  } finally {
    await unlink(outputPath).catch(() => undefined);
  }
}

/** Remove exports past their expiry and mark their jobs expired. */
export async function sweepExpiredExports(supabase: SupabaseClient, limit = 100): Promise<number> {
  const { data, error } = await supabase
    .from(ANKI_EXPORT_JOBS_TABLE)
    .select("id, storage_path")
    .eq("status", "ready")
    .lt("expires_at", new Date().toISOString())
    .limit(limit);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{ id: string; storage_path: string | null }>;
  if (rows.length === 0) return 0;

  const paths = rows.map((row) => row.storage_path).filter((path): path is string => !!path);
  if (paths.length > 0) {
    const removed = await supabase.storage.from(APKG_EXPORTS_BUCKET).remove(paths);
    if (removed.error) throw new Error(removed.error.message);
  }
  const { error: updateError } = await supabase
    .from(ANKI_EXPORT_JOBS_TABLE)
    .update({ status: "expired", storage_path: null, updated_at: new Date().toISOString() })
    .in("id", rows.map((row) => row.id));
  if (updateError) throw new Error(updateError.message);
  return rows.length;
}
