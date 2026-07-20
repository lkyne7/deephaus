import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type WorkerConfig = {
  supabaseUrl: string;
  serviceKey: string;
  appBaseUrl: string;
  workerSecret: string;
  mistralApiKey?: string;
  mistralModel?: string;
  pollMs: number;
  tempDir?: string;
};

export function resolveConfig(): WorkerConfig {
  const supabaseUrl = (
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  )?.replace(/\/+$/, "");
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  const appBaseUrl = process.env.APP_BASE_URL?.replace(/\/+$/, "");
  const workerSecret = process.env.EXTRACTION_WORKER_SECRET;
  if (!supabaseUrl) throw new Error("Missing SUPABASE_URL.");
  if (!serviceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY.");
  if (!appBaseUrl) throw new Error("Missing APP_BASE_URL.");
  if (!workerSecret) throw new Error("Missing EXTRACTION_WORKER_SECRET.");
  return {
    supabaseUrl,
    serviceKey,
    appBaseUrl,
    workerSecret,
    mistralApiKey: process.env.MISTRAL_API_KEY,
    mistralModel: process.env.MISTRAL_OCR_MODEL,
    pollMs: Number(process.env.EXTRACTION_WORKER_POLL_MS) || 3000,
    tempDir: process.env.EXTRACTION_WORKER_TMPDIR,
  };
}

export function createServiceClient(config: WorkerConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
