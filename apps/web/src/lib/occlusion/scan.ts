import "server-only";
import type { SourceType } from "@deephaus/shared";
import { extractSourceImages } from "@/lib/sources/extract-images";
import { detectOcclusionRectsByOcr } from "@/lib/occlusion/ocr";

export type OcclusionScanItem = {
  /** Where the image came from (e.g. "Page 4", "Slide 2", "Figure 1"). */
  ref: string;
  /** Number of label regions OCR found on this image. */
  regionCount: number;
};

export type OcclusionScanResult = {
  /** Images extracted from the document and inspected. */
  scanned: number;
  /** Images with at least one OCR-readable label (eligible for occlusion). */
  qualified: number;
  /** Per-image breakdown for qualified images. */
  items: OcclusionScanItem[];
};

/** Document types that can carry occlusion-eligible images. */
export function supportsOcclusion(sourceType: SourceType): boolean {
  return sourceType === "pdf" || sourceType === "pptx" || sourceType === "docx";
}

/** Keep preview scans responsive — OCR is ~1s/image. */
const MAX_SCAN_IMAGES = 10;

/**
 * Lightweight, OCR-only estimate of how many images in a document qualify for
 * auto image occlusion. Used by the create flow to tell users up front what to
 * expect. Does not call the vision fallback (cost) and does not upload anything.
 */
export async function scanForOcclusion(
  buffer: Buffer,
  sourceType: SourceType,
): Promise<OcclusionScanResult> {
  if (!supportsOcclusion(sourceType)) {
    return { scanned: 0, qualified: 0, items: [] };
  }

  const images = (await extractSourceImages(buffer, sourceType)).slice(
    0,
    MAX_SCAN_IMAGES,
  );

  const items: OcclusionScanItem[] = [];
  for (const image of images) {
    let regionCount = 0;
    try {
      regionCount = (await detectOcclusionRectsByOcr(image.bytes)).length;
    } catch (err) {
      console.warn("[occlusion-scan] OCR failed for image:", err);
    }
    if (regionCount > 0) items.push({ ref: image.ref, regionCount });
  }

  return { scanned: images.length, qualified: items.length, items };
}
