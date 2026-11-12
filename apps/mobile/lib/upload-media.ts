/**
 * Card media uploads read local files with fetch(file://…).blob(), and under
 * expo/fetch that blob has no type, so the multipart part goes out without a
 * Content-Type and the server reads it as text/plain. These helpers give the
 * blob a real type before it is uploaded.
 */

import { CARD_IMAGE_MIME_TYPES } from "@deephaus/shared";

const TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  wav: "audio/wav",
  webm: "audio/webm",
};

const EXTENSION_BY_IMAGE_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** A blob's own type, or "" when it says nothing about the bytes. */
function ownType(blob: Blob): string {
  const type = blob.type.split(";")[0].trim().toLowerCase();
  return type === "application/octet-stream" || type === "text/plain" ? "" : type;
}

/** The media type a file name implies, or "" when the extension isn't a card media type. */
export function mediaTypeForName(name: string): string {
  const extension = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  return TYPE_BY_EXTENSION[extension] ?? "";
}

/** The same bytes labelled with `type`; slicing keeps them in the native blob store. */
export function withMediaType(blob: Blob, type: string): Blob {
  if (!type || blob.type === type) return blob;
  return blob.slice(0, blob.size, type);
}

/** Label a local audio file's blob from what we know about it: its own type, the picker's, or its name. */
export function typedAudioBlob(blob: Blob, filename: string, mimeType?: string | null): Blob {
  const type = ownType(blob) || (mimeType?.startsWith("audio/") ? mimeType : "") || mediaTypeForName(filename);
  return withMediaType(blob, type);
}

/**
 * Label a picked image and name it to match. The picker re-encodes HEIC to JPEG
 * but keeps the original file name, so the name follows the type, not the reverse.
 */
export function typedImageUpload(
  blob: Blob,
  asset: { mimeType?: string | null; fileName?: string | null },
): { blob: Blob; filename: string; baseName: string } {
  // A HEIC original reports image/heic even though the picker hands back JPEG bytes.
  const pickerType = (CARD_IMAGE_MIME_TYPES as readonly string[]).includes(asset.mimeType ?? "") ? asset.mimeType! : "";
  const type = ownType(blob) || pickerType || "image/jpeg";
  const extension = EXTENSION_BY_IMAGE_TYPE[type] ?? "jpg";
  const baseName = (asset.fileName ?? "image").replace(/\.[^.]+$/, "") || "image";
  return { blob: withMediaType(blob, type), filename: `${baseName}.${extension}`, baseName };
}
