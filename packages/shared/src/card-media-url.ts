import { extractCardMediaUrls, isAllowedImageSrc } from "./card-content.js";

/** Public bucket for card images embedded in field markdown. */
export const CARD_MEDIA_BUCKET = "card-media";

export type CardMediaResizeMode = "cover" | "contain" | "fill";

/** Preset widths for common UI surfaces (height follows aspect ratio). */
export type CardMediaDisplaySize = "thumb" | "browse" | "study" | "preview";

const DISPLAY_PRESETS: Record<
  CardMediaDisplaySize,
  { width: number; quality: number; resize: CardMediaResizeMode }
> = {
  thumb: { width: 320, quality: 72, resize: "contain" },
  browse: { width: 560, quality: 75, resize: "contain" },
  preview: { width: 720, quality: 76, resize: "contain" },
  study: { width: 960, quality: 78, resize: "contain" },
};

const OBJECT_PUBLIC_RE =
  /^(https?:\/\/[^/]+)\/storage\/v1\/object\/public\/card-media\/(.+)$/i;

const RENDER_PUBLIC_RE =
  /^(https?:\/\/[^/]+)\/storage\/v1\/render\/image\/public\/card-media\/([^?]+)/i;

export type CardMediaTransformOptions = {
  width?: number;
  quality?: number;
  resize?: CardMediaResizeMode;
};

function buildRenderUrl(
  origin: string,
  objectPath: string,
  opts: Required<CardMediaTransformOptions>,
): string {
  const query = `width=${opts.width}&quality=${opts.quality}&resize=${encodeURIComponent(opts.resize)}`;
  return `${origin}/storage/v1/render/image/public/${CARD_MEDIA_BUCKET}/${objectPath}?${query}`;
}

/** True when `src` points at our public card-media bucket (object or render URL). */
export function isSupabaseCardMediaUrl(src: string): boolean {
  const trimmed = src.trim();
  return OBJECT_PUBLIC_RE.test(trimmed) || RENDER_PUBLIC_RE.test(trimmed);
}

/**
 * Return a Supabase Storage image-transformation URL for card-media assets.
 * Non–card-media URLs are returned unchanged (external images, data URLs, etc.).
 *
 * @see https://supabase.com/docs/guides/storage/serving/image-transformations
 */
export function cardMediaDisplayUrl(
  src: string,
  opts: CardMediaTransformOptions = {},
): string {
  const trimmed = src.trim();
  if (!trimmed || !isAllowedImageSrc(trimmed)) return trimmed;

  const width = clampInt(opts.width ?? 960, 1, 2500);
  const quality = clampInt(opts.quality ?? 75, 20, 100);
  const resize = opts.resize ?? "contain";

  const renderMatch = trimmed.match(RENDER_PUBLIC_RE);
  if (renderMatch) {
    const [, origin, objectPath] = renderMatch;
    return buildRenderUrl(origin, objectPath, { width, quality, resize });
  }

  const objectMatch = trimmed.match(OBJECT_PUBLIC_RE);
  if (objectMatch) {
    const [, origin, objectPath] = objectMatch;
    return buildRenderUrl(origin, objectPath, { width, quality, resize });
  }

  return trimmed;
}

export function cardMediaDisplayUrlSized(
  src: string,
  size: CardMediaDisplaySize,
): string {
  return cardMediaDisplayUrl(src, DISPLAY_PRESETS[size]);
}

/** Image URLs from card fields, rewritten for Supabase image transforms when applicable. */
export function extractCardMediaDisplayUrls(
  size: CardMediaDisplaySize,
  ...fields: Array<string | null | undefined>
): string[] {
  return extractCardMediaUrls(...fields).map((url) => cardMediaDisplayUrlSized(url, size));
}

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)));
}
