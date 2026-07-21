export const MIN_IMAGE_DISPLAY_WIDTH = 20;
export const MAX_IMAGE_DISPLAY_WIDTH = 100;
export const MIN_IMAGE_ASPECT_RATIO = 0.05;
export const MAX_IMAGE_ASPECT_RATIO = 20;

export function clampImageDisplayWidth(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed)) return MAX_IMAGE_DISPLAY_WIDTH;
  const clamped = Math.min(
    MAX_IMAGE_DISPLAY_WIDTH,
    Math.max(MIN_IMAGE_DISPLAY_WIDTH, parsed),
  );
  return Math.round(clamped * 100) / 100;
}

export function normalizeImageAspectRatio(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (
    !Number.isFinite(parsed) ||
    parsed < MIN_IMAGE_ASPECT_RATIO ||
    parsed > MAX_IMAGE_ASPECT_RATIO
  ) {
    return null;
  }
  return Math.round(parsed * 10_000) / 10_000;
}

export type CardContentSegment =
  | { type: "text"; value: string }
  | {
      type: "image";
      alt: string;
      src: string;
      displayWidth: number;
      aspectRatio?: number;
    };

const MEDIA_PATTERN =
  /!\[([^\]]*)\]\(([^)]+)\)|<img\b[^>]*>/gi;

function decodeHtmlAttribute(value: string): string {
  return value.replace(
    /&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi,
    (entity, key: string) => {
      const normalized = key.toLowerCase();
      if (normalized === "amp") return "&";
      if (normalized === "quot") return '"';
      if (normalized === "apos") return "'";
      if (normalized === "lt") return "<";
      if (normalized === "gt") return ">";
      const radix = normalized.startsWith("#x") ? 16 : 10;
      const numeric = Number.parseInt(normalized.replace(/^#x?/, ""), radix);
      return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : entity;
    },
  );
}

function parseHtmlAttributes(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const pattern = /([a-zA-Z0-9:-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(tag)) !== null) {
    attributes.set(
      match[1].toLowerCase(),
      decodeHtmlAttribute(match[3] ?? match[4] ?? match[5] ?? ""),
    );
  }
  return attributes;
}

function imageSegmentFromMatch(match: RegExpMatchArray): Extract<CardContentSegment, { type: "image" }> | null {
  if (match[2] != null) {
    const src = match[2].trim();
    if (!isAllowedImageSrc(src)) return null;
    return {
      type: "image",
      alt: match[1]?.trim() || "Card image",
      src,
      displayWidth: MAX_IMAGE_DISPLAY_WIDTH,
    };
  }

  const attributes = parseHtmlAttributes(match[0]);
  const src = (attributes.get("src") ?? "").trim();
  if (!isAllowedImageSrc(src)) return null;
  const aspectRatio = normalizeImageAspectRatio(attributes.get("data-aspect-ratio"));
  return {
    type: "image",
    alt: attributes.get("alt")?.trim() || "Card image",
    src,
    displayWidth: clampImageDisplayWidth(attributes.get("data-display-width")),
    ...(aspectRatio == null ? {} : { aspectRatio }),
  };
}

export function isAllowedImageSrc(src: string): boolean {
  const trimmed = src.trim();
  if (!trimmed) return false;
  return /^https?:\/\/.+/i.test(trimmed);
}

export function parseCardContent(raw: string): CardContentSegment[] {
  if (!raw) return [];

  const segments: CardContentSegment[] = [];
  let lastIndex = 0;

  for (const match of raw.matchAll(MEDIA_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ type: "text", value: raw.slice(lastIndex, index) });
    }

    const image = imageSegmentFromMatch(match);
    if (image) segments.push(image);

    lastIndex = index + match[0].length;
  }

  if (lastIndex < raw.length) {
    segments.push({ type: "text", value: raw.slice(lastIndex) });
  }

  return segments;
}

export function stripCardMedia(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "[image]")
    .replace(/<img[^>]*>/gi, "[image]")
    .replace(/\s+/g, " ")
    .trim();
}

export function cardMediaSnippet(url: string, alt = "image"): string {
  return `\n\n![${alt}](${url})`;
}

export function extractCardMediaUrls(
  ...fields: Array<string | null | undefined>
): string[] {
  const urls = new Set<string>();
  for (const field of fields) {
    if (!field) continue;
    for (const segment of parseCardContent(field)) {
      if (segment.type === "image") urls.add(segment.src);
    }
  }
  return [...urls];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function imageDimensionsHtml(displayWidth: number, aspectRatio?: number): string {
  if (displayWidth === MAX_IMAGE_DISPLAY_WIDTH && aspectRatio == null) return "";
  const width = clampImageDisplayWidth(displayWidth);
  const ratio = normalizeImageAspectRatio(aspectRatio);
  const style = [
    `width: ${width}%`,
    "max-width: 100%",
    "height: auto",
    ratio == null ? null : `aspect-ratio: ${ratio}`,
  ]
    .filter(Boolean)
    .join("; ");
  return [
    ` data-display-width="${width}"`,
    ratio == null ? "" : ` data-aspect-ratio="${ratio}"`,
    ` style="${style}"`,
  ].join("");
}

export function rewriteCardMediaForAnki(
  text: string | null | undefined,
  urlToFilename: ReadonlyMap<string, string>,
): string | undefined {
  if (!text) return undefined;

  let changed = false;
  const out = text.replace(MEDIA_PATTERN, (...args: unknown[]) => {
    const match = args[0] as string;
    const markdownAlt = args[1] as string | undefined;
    const markdownUrl = args[2] as string | undefined;
    const attributes = markdownUrl == null ? parseHtmlAttributes(match) : null;
    const url = (markdownUrl ?? attributes?.get("src") ?? "").trim();
    const filename = urlToFilename.get(url);
    changed = true;
    if (!filename) {
      return "";
    }

    const alt = (markdownAlt ?? attributes?.get("alt") ?? "").trim();
    const displayWidth = clampImageDisplayWidth(
      attributes?.get("data-display-width"),
    );
    const aspectRatio =
      normalizeImageAspectRatio(attributes?.get("data-aspect-ratio")) ?? undefined;
    const altAttribute = alt ? ` alt="${escapeHtml(alt)}"` : "";
    return `<img src="${escapeHtml(filename)}"${altAttribute}${imageDimensionsHtml(
      displayWidth,
      aspectRatio,
    )}>`;
  });

  if (!changed) return text;
  return out.replace(/\n{3,}/g, "\n\n").trim();
}
