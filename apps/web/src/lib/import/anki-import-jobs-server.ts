import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AnkiImportResult } from "@deephaus/anki-import";

export const ANKI_IMPORT_JOBS_TABLE = "anki_import_jobs";

export type AnkiImportJobStatus = "pending" | "processing" | "ready" | "failed";

export type AnkiImportJobRow = {
  id: string;
  user_id: string;
  storage_path: string;
  filename: string | null;
  file_size: number | null;
  status: AnkiImportJobStatus;
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
  Pick<
    AnkiImportJobRow,
    "status" | "phase" | "progress" | "result" | "error" | "claimed_at"
  >
>;

export async function updateAnkiImportJob(
  supabase: SupabaseClient,
  id: string,
  patch: AnkiImportJobPatch,
): Promise<void> {
  await supabase
    .from(ANKI_IMPORT_JOBS_TABLE)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
}
