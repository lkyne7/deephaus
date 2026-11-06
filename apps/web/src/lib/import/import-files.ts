import { MAX_APKG_BYTES } from "@deephaus/shared";

export const MAX_APKG_GB = Math.round(MAX_APKG_BYTES / (1024 * 1024 * 1024));

/** Why a file can't be imported as an Anki package, or null when it can. */
export function ankiPackageError(file: Pick<File, "name" | "size">): string | null {
  if (!/\.(apkg|colpkg)$/i.test(file.name)) return "Choose an Anki package (.apkg or .colpkg).";
  if (file.size > MAX_APKG_BYTES) return `File must be under ${MAX_APKG_GB} GB.`;
  return null;
}

/** Imports take one file. A drop can carry several, so say so rather than guess. */
export function onlyFile<T>(files: readonly T[]): { file: T } | { error: string } {
  if (files.length === 1) return { file: files[0]! };
  return { error: "Drop one file at a time." };
}
