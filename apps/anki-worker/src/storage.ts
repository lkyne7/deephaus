import { createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type { SupabaseClient } from "@supabase/supabase-js";

// Matches ANKG_IMPORTS_BUCKET in the web app.
export const APKG_IMPORTS_BUCKET = "apkg-imports";

/**
 * Stream a stored .apkg to local disk via a signed URL. Using a signed URL +
 * `fetch` streams the body straight to a file with constant memory, unlike
 * `storage.download()` which buffers the entire object first.
 */
export async function downloadToTempFile(
  supabase: SupabaseClient,
  storagePath: string,
): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const { data, error } = await supabase.storage
    .from(APKG_IMPORTS_BUCKET)
    .createSignedUrl(storagePath, 60 * 60);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? "Could not create a signed download URL.");
  }

  const res = await fetch(data.signedUrl);
  if (!res.ok || !res.body) {
    throw new Error(`Download failed with status ${res.status}.`);
  }

  // Allow pointing at a mounted volume on hosts where /tmp is small.
  const scratchDir = process.env.ANKI_WORKER_TMPDIR || tmpdir();
  const path = join(scratchDir, `anki-${randomUUID()}.apkg`);
  await pipeline(
    Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(path),
  );

  return {
    path,
    cleanup: async () => {
      try {
        await unlink(path);
      } catch {
        // best-effort temp cleanup
      }
    },
  };
}

export async function removeStorageObject(
  supabase: SupabaseClient,
  storagePath: string,
): Promise<void> {
  const { error } = await supabase.storage.from(APKG_IMPORTS_BUCKET).remove([storagePath]);
  if (error) {
    console.warn("[anki-worker] storage cleanup failed:", error.message);
  }
}
