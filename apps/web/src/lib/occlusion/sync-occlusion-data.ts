import type { ImageOcclusionData } from "@deephaus/shared";

export function occlusionDataEqual(
  a: ImageOcclusionData | null | undefined,
  b: ImageOcclusionData | null | undefined,
): boolean {
  if (!a || !b) return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}
