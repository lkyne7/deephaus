/** Client-safe helpers for Anki .apkg storage imports. */

export const ANKG_IMPORTS_BUCKET = "apkg-imports";

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
