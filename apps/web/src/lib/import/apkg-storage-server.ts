import "server-only";

import { createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ANKG_IMPORTS_BUCKET } from "@/lib/import/apkg-import-constants";

async function writeBlobToFile(blob: Blob, path: string): Promise<void> {
  const stream = blob.stream?.();
  if (stream) {
    await pipeline(
      Readable.fromWeb(stream as Parameters<typeof Readable.fromWeb>[0]),
      createWriteStream(path),
    );
    return;
  }
  const buffer = Buffer.from(await blob.arrayBuffer());
  await pipeline(Readable.from(buffer), createWriteStream(path));
}

/** Stream a stored .apkg to a temp file so JSZip can read it without loading multi-GB buffers. */
export async function downloadApkgToTempFile(
  supabase: SupabaseClient,
  storagePath: string,
): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const { data, error } = await supabase.storage.from(ANKG_IMPORTS_BUCKET).download(storagePath);
  if (error || !data) {
    throw new Error(error?.message ?? "Could not download the uploaded package.");
  }

  const path = join(tmpdir(), `deephaus-apkg-${randomUUID()}.apkg`);
  await writeBlobToFile(data, path);

  return {
    path,
    cleanup: async () => {
      try {
        await unlink(path);
      } catch {
        // Best-effort temp cleanup.
      }
    },
  };
}

export async function removeApkgImportObject(
  supabase: SupabaseClient,
  storagePath: string,
): Promise<void> {
  const { error } = await supabase.storage.from(ANKG_IMPORTS_BUCKET).remove([storagePath]);
  if (error) {
    console.warn("[apkg-import] storage cleanup failed:", error.message);
  }
}
