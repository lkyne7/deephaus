import type { SupabaseClient } from "@supabase/supabase-js";
import { parseApkgCollectionBytes, type ParsedApkg } from "@deephaus/apkg";
import { importAnkiPackage } from "@deephaus/anki-import";
import { default_w } from "ts-fsrs";
import {
  ApkgArchive,
  createArchiveMediaReader,
  loadCollectionBytes,
} from "./zip-reader.js";
import { downloadToTempFile, removeStorageObject } from "./storage.js";
import { updateJob, type AnkiImportJobRow } from "./jobs.js";

const FSRS_PARAM_COUNT = default_w.length;

/**
 * Stream a stored package to disk, parse the collection (ignoring revlog),
 * import cards + referenced media, and write progress/result back to the job.
 * Memory stays roughly constant regardless of package size: only the SQLite
 * collection and one media image at a time are ever held in memory.
 */
export async function processJob(
  supabase: SupabaseClient,
  job: AnkiImportJobRow,
): Promise<void> {
  await updateJob(supabase, job.id, { phase: "downloading", progress: 3 });
  const { path, cleanup } = await downloadToTempFile(supabase, job.storage_path);

  let archive: ApkgArchive | undefined;
  try {
    await updateJob(supabase, job.id, { phase: "parsing", progress: 6 });
    archive = await ApkgArchive.open(path);

    const collectionBytes = await loadCollectionBytes(archive);
    const parsedCollection = await parseApkgCollectionBytes(collectionBytes, {
      fsrsParamCount: FSRS_PARAM_COUNT,
    });
    if (parsedCollection.decks.length === 0 || parsedCollection.stats.cardCount === 0) {
      throw new Error("No importable cards were found in this package.");
    }

    const mediaReader = await createArchiveMediaReader(archive);

    const parsed: ParsedApkg = {
      decks: parsedCollection.decks,
      media: new Map<string, Uint8Array>(),
      stats: { ...parsedCollection.stats, mediaCount: 0 },
    };

    const result = await importAnkiPackage(supabase, job.user_id, parsed, {
      deckNameOverride: job.deck_name_override ?? undefined,
      importScheduling: job.scheduling,
      mediaReader,
      onProgress: (progress, phase) => updateJob(supabase, job.id, { progress, phase }),
    });

    await updateJob(supabase, job.id, {
      status: "ready",
      phase: "done",
      progress: 100,
      result,
    });
    await removeStorageObject(supabase, job.storage_path);
  } finally {
    archive?.close();
    await cleanup();
  }
}
