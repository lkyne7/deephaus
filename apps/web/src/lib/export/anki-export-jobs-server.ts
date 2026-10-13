import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { APKG_EXPORTS_BUCKET, type AnkiExportJobRow } from "@deephaus/anki-export";

export type { AnkiExportJobRow };
export { ANKI_EXPORT_JOBS_TABLE, updateAnkiExportJob } from "@deephaus/anki-export";

/** Signed download URLs stay valid this long. */
export const EXPORT_DOWNLOAD_URL_TTL_SECONDS = 60 * 60;

/** Service-role credentials for the resumable upload of a finished package. */
export function exportServiceCredentials(): { supabaseUrl: string; serviceKey: string } {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for exports.");
  }
  return { supabaseUrl, serviceKey };
}

/** A time-limited URL that downloads a finished export with its deck filename. */
export async function createExportDownloadUrl(
  service: SupabaseClient,
  storagePath: string,
  filename: string,
): Promise<string> {
  const { data, error } = await service.storage
    .from(APKG_EXPORTS_BUCKET)
    .createSignedUrl(storagePath, EXPORT_DOWNLOAD_URL_TTL_SECONDS, { download: filename });
  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? "Could not create a download link.");
  }
  return data.signedUrl;
}
