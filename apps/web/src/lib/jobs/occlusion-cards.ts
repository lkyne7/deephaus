import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildOcclusionCardFront,
  normalizeOcclusionRect,
  OCCLUSION_ORD_MAX,
  type ImageOcclusionData,
  type OcclusionRect,
} from "@deephaus/shared";
import { detectOcclusionRects } from "@deephaus/llm";
import { detectOcclusionRectsByOcr } from "@/lib/occlusion/ocr";
import type { ExtractedImage } from "@/lib/sources/extract-images";

/** A ready-to-insert image-occlusion card row for the cards table. */
export type OcclusionCardRow = {
  job_id: string;
  type: "image-occlusion";
  front: string;
  back: null;
  cloze_text: null;
  extra: null;
  occlusion_data: ImageOcclusionData;
  tags: string[];
  sort_order: number;
  /** Source segment label (the image ref, e.g. "Page 4"); chunk id filled by the processor. */
  source_ref: string | null;
  source_chunk_id: string | null;
  /** Occlusion cards are image-based, so they never carry a text evidence quote. */
  source_quote: null;
};

/** Outcome counts so callers can tell users what auto-occlusion produced. */
export type OcclusionBuildStats = {
  /** Images handed to detection. */
  scanned: number;
  /** Cards whose regions came from on-device OCR. */
  ocrCards: number;
  /** Cards whose regions came from the vision fallback. */
  visionCards: number;
};

export type OcclusionBuildResult = {
  rows: OcclusionCardRow[];
  stats: OcclusionBuildStats;
};

export type OcclusionBuildOptions = {
  /** When set, low/no-OCR images fall back to a vision model for detection. */
  vision?: { apiKey: string; model?: string };
  onProgress?: (completed: number, total: number) => void;
};

const CARD_MEDIA_BUCKET = "card-media";

function extensionForMime(mime: string): string {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/gif") return "gif";
  if (mime === "image/webp") return "webp";
  return "png";
}

function toDataUrl(image: ExtractedImage): string {
  return `data:${image.mime};base64,${image.bytes.toString("base64")}`;
}

/**
 * Give each detected region its own cloze group (1–9) so every label becomes a
 * separate "hide one, reveal the rest" study card. Regions beyond the 9th are
 * dropped — a single occlusion card supports at most 9 distinct groups.
 */
function assignOrdinals(rects: OcclusionRect[]): OcclusionRect[] {
  return rects.slice(0, OCCLUSION_ORD_MAX).map((rect, index) =>
    normalizeOcclusionRect({ ...rect, ord: index + 1, enabled: true }),
  );
}

async function uploadImage(
  supabase: SupabaseClient,
  userId: string,
  jobId: string,
  image: ExtractedImage,
  index: number,
): Promise<string | null> {
  const path = `${userId}/auto-occlusion/${jobId}/${index}.${extensionForMime(image.mime)}`;
  const { error } = await supabase.storage
    .from(CARD_MEDIA_BUCKET)
    .upload(path, image.bytes, {
      contentType: image.mime,
      upsert: true,
      cacheControl: "31536000",
    });
  if (error) {
    console.warn("[occlusion-cards] upload failed:", error.message);
    return null;
  }
  return supabase.storage.from(CARD_MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
}

/**
 * Detect occlusion regions for one image: on-device OCR first (free, pixel
 * accurate), then a vision model fallback when OCR finds nothing and vision is
 * configured. Returns the regions plus which engine produced them.
 */
async function detectRegions(
  image: ExtractedImage,
  vision: OcclusionBuildOptions["vision"],
): Promise<{ rects: OcclusionRect[]; source: "ocr" | "vision" | "none" }> {
  try {
    const ocrRects = await detectOcclusionRectsByOcr(image.bytes);
    if (ocrRects.length > 0) return { rects: ocrRects, source: "ocr" };
  } catch (err) {
    console.warn("[occlusion-cards] OCR failed for image:", err);
  }

  if (vision?.apiKey) {
    try {
      const visionRects = await detectOcclusionRects(toDataUrl(image), {
        apiKey: vision.apiKey,
        model: vision.model,
      });
      if (visionRects.length > 0) return { rects: visionRects, source: "vision" };
    } catch (err) {
      console.warn("[occlusion-cards] vision fallback failed for image:", err);
    }
  }

  return { rects: [], source: "none" };
}

/**
 * Turn extracted document images into image-occlusion card rows. Detection runs
 * with on-device OCR (no extra API cost), falling back to a vision model when
 * OCR finds nothing. Images that yield no label regions are skipped. Best-effort:
 * any per-image failure is swallowed so text-card generation is never blocked.
 */
export async function buildOcclusionCardsFromImages(
  supabase: SupabaseClient,
  userId: string,
  jobId: string,
  images: ExtractedImage[],
  startSortOrder: number,
  options?: OcclusionBuildOptions,
): Promise<OcclusionBuildResult> {
  const rows: OcclusionCardRow[] = [];
  const stats: OcclusionBuildStats = { scanned: images.length, ocrCards: 0, visionCards: 0 };
  let sortOrder = startSortOrder;

  for (let i = 0; i < images.length; i += 1) {
    const image = images[i];
    try {
      const { rects: detected, source } = await detectRegions(image, options?.vision);
      const rects = assignOrdinals(detected);
      if (rects.length === 0) continue;

      const imageUrl = await uploadImage(supabase, userId, jobId, image, i);
      if (!imageUrl) continue;

      const occlusion_data: ImageOcclusionData = { imageUrl, rects };
      rows.push({
        job_id: jobId,
        type: "image-occlusion",
        front: buildOcclusionCardFront(imageUrl, image.ref),
        back: null,
        cloze_text: null,
        extra: null,
        occlusion_data,
        tags: ["Image Occlusion", image.ref].filter(Boolean),
        sort_order: sortOrder,
        source_ref: image.ref || null,
        source_chunk_id: null,
        source_quote: null,
      });
      sortOrder += 1;
      if (source === "vision") stats.visionCards += 1;
      else stats.ocrCards += 1;
    } catch (err) {
      console.warn("[occlusion-cards] image failed:", err);
    } finally {
      options?.onProgress?.(i + 1, images.length);
    }
  }

  return { rows, stats };
}
