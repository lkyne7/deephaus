import { createWriteStream } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ExtractedDocument } from "@deephaus/pdf-extraction";
import type { SupabaseClient } from "@supabase/supabase-js";

const SOURCE_BUCKET = "pdfs";
const MEDIA_BUCKET = "card-media";

function extension(mime: string): string {
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  return "png";
}

export async function downloadPdf(
  supabase: SupabaseClient,
  storagePath: string,
  scratchDirectory?: string,
): Promise<{
  path: string;
  bytes: Uint8Array;
  signedUrl: string;
  cleanup: () => Promise<void>;
}> {
  const { data, error } = await supabase.storage
    .from(SOURCE_BUCKET)
    .createSignedUrl(storagePath, 60 * 60);
  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? "Could not create source download URL.");
  }
  const response = await fetch(data.signedUrl);
  if (!response.ok || !response.body) {
    throw new Error(`Source download failed (${response.status}).`);
  }
  const path = join(scratchDirectory || tmpdir(), `source-${randomUUID()}.pdf`);
  await pipeline(
    Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(path),
  );
  return {
    path,
    bytes: new Uint8Array(await readFile(path)),
    signedUrl: data.signedUrl,
    cleanup: async () => {
      try {
        await unlink(path);
      } catch {
        // Best-effort cleanup.
      }
    },
  };
}

export async function persistExtractedImages(
  supabase: SupabaseClient,
  userId: string,
  sourceId: string,
  document: ExtractedDocument,
): Promise<ExtractedDocument> {
  const output = structuredClone(document);
  for (const page of output.pages) {
    for (const block of page.blocks) {
      const image = block.image;
      if (!image?.dataUrl) continue;
      const match = /^data:([^;,]+);base64,(.+)$/s.exec(image.dataUrl);
      if (!match) continue;
      const mime = match[1] ?? image.mime;
      const name = `${page.pageNumber}-${image.id}.${extension(mime)}`.replace(
        /[^a-zA-Z0-9._-]/g,
        "_",
      );
      const path = `${userId}/source-media/${sourceId}/pdf-v2-${name}`;
      const { error } = await supabase.storage
        .from(MEDIA_BUCKET)
        .upload(path, Buffer.from(match[2]!, "base64"), {
          contentType: mime,
          upsert: true,
          cacheControl: "31536000",
        });
      if (error) continue;
      image.storageUrl = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
      const placeholder = image.id;
      page.markdown = page.markdown
        .replaceAll(`(${placeholder})`, `(${image.storageUrl})`)
        .replaceAll(`](./${placeholder})`, `](${image.storageUrl})`);
      block.markdown = `![${image.alt ?? "Figure"}](${image.storageUrl})`;
      delete image.dataUrl;
    }
  }
  return output;
}
