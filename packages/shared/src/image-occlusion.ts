import { z } from "zod";
import { cardMediaSnippet, extractCardMediaUrls, parseCardContent } from "./card-content.js";
import { MAX_CLOZE_DELETIONS } from "./schemas.js";

export const OCCLUSION_ORD_MIN = 1;
export const OCCLUSION_ORD_MAX = MAX_CLOZE_DELETIONS;

export const occlusionRectSchema = z.object({
  id: z.string().min(1),
  /** Normalized 0–1, relative to image width */
  x: z.number().min(0).max(1),
  /** Normalized 0–1, relative to image height */
  y: z.number().min(0).max(1),
  width: z.number().min(0.01).max(1),
  height: z.number().min(0.01).max(1),
  label: z.string().optional(),
  /** When false, rect is saved but not included in study queue */
  enabled: z.boolean().optional(),
  /**
   * Cloze group (1–9), like {{c1::}} / {{c2::}}. Regions sharing an ord are one study
   * card; different ords are separate cards in the queue.
   */
  ord: z.number().int().min(OCCLUSION_ORD_MIN).max(OCCLUSION_ORD_MAX).optional(),
});

export type OcclusionRect = z.infer<typeof occlusionRectSchema>;

export const imageOcclusionDataSchema = z.object({
  imageUrl: z.string().url(),
  rects: z.array(occlusionRectSchema),
});

export type ImageOcclusionData = z.infer<typeof imageOcclusionDataSchema>;

export function createOcclusionRectId(): string {
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function occlusionRectOrd(rect: OcclusionRect): number {
  const n = rect.ord ?? OCCLUSION_ORD_MIN;
  return Math.min(Math.max(n, OCCLUSION_ORD_MIN), OCCLUSION_ORD_MAX);
}

export function normalizeOcclusionRect(rect: OcclusionRect): OcclusionRect {
  const x = clamp01(rect.x);
  const y = clamp01(rect.y);
  const width = clamp01(Math.min(rect.width, 1 - x));
  const height = clamp01(Math.min(rect.height, 1 - y));
  return {
    ...rect,
    x,
    y,
    width: Math.max(width, 0.01),
    height: Math.max(height, 0.01),
    enabled: rect.enabled !== false,
    ord: occlusionRectOrd(rect),
  };
}

export function parseImageOcclusionData(raw: unknown): ImageOcclusionData | null {
  if (!raw) return null;
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    const parsed = imageOcclusionDataSchema.safeParse(value);
    if (!parsed.success) return null;
    return {
      ...parsed.data,
      rects: parsed.data.rects.map(normalizeOcclusionRect),
    };
  } catch {
    return null;
  }
}

export function enabledOcclusionRects(data: ImageOcclusionData): OcclusionRect[] {
  return data.rects.filter((rect) => rect.enabled !== false);
}

/** Unique cloze ords (1–9) used by enabled regions — drives the study queue. */
export function occlusionOrdinals(data: ImageOcclusionData): number[] {
  const ords = new Set<number>();
  for (const rect of enabledOcclusionRects(data)) {
    ords.add(occlusionRectOrd(rect));
  }
  return [...ords].sort((a, b) => a - b);
}

export function occlusionOrdLabel(ord: number): string {
  return `C${ord}`;
}

/** Extract the first image URL found across any card field strings. */
export function imageUrlFromCardFields(
  ...fields: Array<string | null | undefined>
): string | null {
  const urls = extractCardMediaUrls(...fields);
  return urls[0] ?? null;
}

export type OcclusionConversionSource = {
  type: "basic" | "cloze" | "image-occlusion";
  front?: string | null;
  back?: string | null;
  cloze_text?: string | null;
  extra?: string | null;
  occlusion_data?: unknown;
};

/** Image on the card front field only (basic front or cloze text). */
export function imageUrlOnCardFront(source: OcclusionConversionSource): string | null {
  if (source.type === "cloze") {
    return imageUrlFromCardFields(source.cloze_text);
  }
  if (source.type === "image-occlusion") {
    const parsed = parseImageOcclusionData(source.occlusion_data);
    return parsed?.imageUrl ?? imageUrlFromCardFields(source.front);
  }
  return imageUrlFromCardFields(source.front);
}

/**
 * Find an image to set up occlusion regions on a card (basic front, cloze text,
 * or an existing occlusion image). Used by the auto-detect route.
 */
export function imageUrlForOcclusionSetup(source: OcclusionConversionSource): string | null {
  return imageUrlOnCardFront(source);
}

export function buildOcclusionCardFront(imageUrl: string, header?: string | null): string {
  const image = cardMediaSnippet(imageUrl, "image");
  const text = header?.trim();
  return text ? `${text}\n\n${image}` : image;
}

export function mergeOcclusionIntoCard(
  imageUrl: string,
  data: ImageOcclusionData,
  header?: string | null,
): { front: string; occlusion_data: ImageOcclusionData } {
  return {
    front: buildOcclusionCardFront(imageUrl, header),
    occlusion_data: { ...data, imageUrl },
  };
}

/** Strip image markdown for list previews. */
export function occlusionCardPreviewText(
  front: string | null | undefined,
  back: string | null | undefined,
): string {
  const segments = parseCardContent(front ?? "");
  const textParts = segments
    .filter((s) => s.type === "text")
    .map((s) => s.value.trim())
    .filter(Boolean);
  const label = textParts.join(" ") || back?.trim() || "[Image occlusion]";
  return label;
}
