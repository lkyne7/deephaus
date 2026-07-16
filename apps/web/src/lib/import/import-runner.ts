import "server-only";

import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { parseApkgFromZip, readApkgMediaFile } from "@deephaus/apkg";
import {
  importAnkiPackage,
  type AnkiImportOptions,
  type AnkiImportResult,
} from "@deephaus/anki-import";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FSRS_PARAM_COUNT } from "@/lib/fsrs/scheduler";
import { downloadApkgToTempFile } from "@/lib/import/apkg-storage-server";

export type RunApkgImportOptions = Pick<
  AnkiImportOptions,
  "deckNameOverride" | "importScheduling" | "onProgress"
>;

/**
 * Inline import path for packages small enough to process inside a serverless
 * request: download the stored .apkg to /tmp, parse with JSZip + sql.js, and
 * import. Large packages are handled out-of-band by the standalone worker,
 * which streams the archive instead of buffering it. The `revlog` table is never
 * read, so review history never inflates memory here.
 *
 * JSZip cannot load Node streams — we read the temp file into a Buffer (safe
 * because this path is size-capped by ANKI_INLINE_MAX_MB).
 */
export async function runApkgImportFromStorage(
  supabase: SupabaseClient,
  userId: string,
  storagePath: string,
  options: RunApkgImportOptions = {},
): Promise<AnkiImportResult> {
  const downloaded = await downloadApkgToTempFile(supabase, storagePath);
  try {
    const bytes = await readFile(downloaded.path);
    const zip = await JSZip.loadAsync(bytes);
    const parsed = await parseApkgFromZip(zip, {
      fsrsParamCount: FSRS_PARAM_COUNT,
      eagerMedia: false,
    });
    if (parsed.decks.length === 0 || parsed.stats.cardCount === 0) {
      throw new Error("No importable cards were found in this package.");
    }
    return await importAnkiPackage(supabase, userId, parsed, {
      deckNameOverride: options.deckNameOverride,
      importScheduling: options.importScheduling,
      mediaReader: (name) => readApkgMediaFile(zip, name),
      onProgress: options.onProgress,
    });
  } finally {
    await downloaded.cleanup();
  }
}
