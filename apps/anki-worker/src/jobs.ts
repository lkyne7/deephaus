import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AnkiImportResult } from "@deephaus/anki-import";
import { resolveSupabaseAdminConfig } from "./supabase-config.js";

export const ANKI_IMPORT_JOBS_TABLE = "anki_import_jobs";

export type AnkiImportJobRow = {
  id: string;
  user_id: string;
  storage_path: string;
  filename: string | null;
  file_size: number | null;
  status: "pending" | "processing" | "ready" | "failed";
  phase: string | null;
  progress: number;
  scheduling: boolean;
  deck_name_override: string | null;
  result: AnkiImportResult | null;
  error: string | null;
  attempts: number;
  claimed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AnkiImportJobPatch = Partial<
  Pick<AnkiImportJobRow, "status" | "phase" | "progress" | "result" | "error">
>;

export function createServiceClient(): SupabaseClient {
  const { url, key } = resolveSupabaseAdminConfig();
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Atomically claim the next queued job, or null when the queue is empty. */
export async function claimNextJob(
  supabase: SupabaseClient,
): Promise<AnkiImportJobRow | null> {
  const { data, error } = await supabase.rpc("claim_anki_import_job");
  if (error) throw new Error(error.message);
  const row = data as AnkiImportJobRow | null;
  if (!row?.id) return null;
  return row;
}

export async function updateJob(
  supabase: SupabaseClient,
  id: string,
  patch: AnkiImportJobPatch,
): Promise<void> {
  const { error } = await supabase
    .from(ANKI_IMPORT_JOBS_TABLE)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    console.warn(`[anki-worker] failed to update job ${id}:`, error.message);
  }
}
