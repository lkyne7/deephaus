import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildOcclusionCardFront,
  normalizeOcclusionRect,
  OCCLUSION_ORD_MAX,
  type ImageOcclusionData,
  type OcclusionRect,
} from "@deephaus/shared";
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
};

const CARD_MEDIA_BUCKET = "card-media";

function extensionForMime(mime: string): string {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/gif") return "gif";
  if (mime === "image/webp") return "webp";
  return "png";
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
 * Turn extracted document images into image-occlusion card rows. Detection runs
 * with on-device OCR (no extra API cost). Images that yield no label regions are
 * skipped. Best-effort: any per-image failure is swallowed so text-card
 * generation is never blocked.
 */
export async function buildOcclusionCardsFromImages(
  supabase: SupabaseClient,
  userId: string,
  jobId: string,
  images: ExtractedImage[],
  startSortOrder: number,
  onProgress?: (completed: number, total: number) => void,
): Promise<OcclusionCardRow[]> {
  const rows: OcclusionCardRow[] = [];
  let sortOrder = startSortOrder;

  for (let i = 0; i < images.length; i += 1) {
    const image = images[i];
    try {
      const detected = await detectOcclusionRectsByOcr(image.bytes);
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
        tags: ["Image Occlusion"],
        sort_order: sortOrder,
      });
      sortOrder += 1;
    } catch (err) {
      console.warn("[occlusion-cards] image failed:", err);
    } finally {
      onProgress?.(i + 1, images.length);
    }
  }

  return rows;
}
