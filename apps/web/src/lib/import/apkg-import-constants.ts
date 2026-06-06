/** Client-safe helpers for Anki .apkg storage imports. */

import { MAX_APKG_BYTES } from "@deephaus/shared";

export const ANKG_IMPORTS_BUCKET = "apkg-imports";

/** Per-bucket ceiling for apkg-imports (must be ≤ the project's global Storage limit). */
export const APKG_BUCKET_MAX_BYTES = MAX_APKG_BYTES;

export function apkgImportStoragePath(userId: string, importId: string, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 200) || "import.apkg";
  return `${userId}/${importId}/${safe}`;
}

export function assertApkgStoragePathOwned(userId: string, storagePath: string): void {
  const prefix = `${userId}/`;
  if (!storagePath.startsWith(prefix) || storagePath.includes("..")) {
    throw new Error("Invalid import path.");
  }
}
