import type { SupabaseClient } from "@supabase/supabase-js";

export type ExtractionJobRow = {
  id: string;
  source_id: string;
  /** 'extract' = hybrid PDF extraction; 'preview' = Office→PDF conversion. */
  kind: "extract" | "preview";
  storage_path: string;
  filename: string;
  file_size: number | null;
  status: "pending" | "processing" | "ready" | "failed";
  phase: string;
  progress: number;
  pages_total: number | null;
  pages_completed: number;
  requested_generation: {
    generate?: boolean;
    settings?: Record<string, unknown>;
    chunkIndices?: number[];
  } | null;
  extract_images: boolean;
  attempts: number;
};

export type JobPatch = Partial<
  Pick<
    ExtractionJobRow,
    | "status"
    | "phase"
    | "progress"
    | "pages_total"
    | "pages_completed"
  >
> & {
  heartbeat_at?: string;
  extractor_version?: string;
  quality_score?: number;
  generation_job_id?: string;
  error?: string | null;
};

export async function claimNextJob(
  supabase: SupabaseClient,
): Promise<ExtractionJobRow | null> {
  const { data, error } = await supabase.rpc("claim_source_extraction_job");
  if (error) throw new Error(error.message);
  const row = data as ExtractionJobRow | null;
  return row?.id ? row : null;
}

export async function updateJob(
  supabase: SupabaseClient,
  id: string,
  patch: JobPatch,
): Promise<void> {
  const { error } = await supabase
    .from("source_extraction_jobs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}
