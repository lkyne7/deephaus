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
    }
  | {
      /** An inline audio clip: `<audio src="…" title="…"></audio>`. */
      type: "audio";
      src: string;
      title: string;
    };

/** Markdown images, `<img>` tags, and `<audio>` tags (with or without a closing tag). */
const MEDIA_PATTERN =
  /!\[([^\]]*)\]\(([^)]+)\)|<img\b[^>]*>|<audio\b[^>]*>(?:\s*<\/audio>)?/gi;
const AUDIO_TAG_PATTERN = /<audio\b[^>]*>(?:\s*<\/audio>)?/gi;
const DEFAULT_AUDIO_TITLE = "Audio";

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

function mediaSegmentFromMatch(
  match: RegExpMatchArray,
): Exclude<CardContentSegment, { type: "text" }> | null {
  if (/^<audio/i.test(match[0])) {
    const attributes = parseHtmlAttributes(match[0]);
    const src = (attributes.get("src") ?? "").trim();
    if (!isAllowedMediaSrc(src)) return null;
    return {
      type: "audio",
      src,
      title: attributes.get("title")?.trim() || DEFAULT_AUDIO_TITLE,
    };
  }

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

/** Card media of any kind must be an absolute http(s) URL. */
export const isAllowedMediaSrc = isAllowedImageSrc;

export function parseCardContent(raw: string): CardContentSegment[] {
  if (!raw) return [];

  const segments: CardContentSegment[] = [];
  let lastIndex = 0;

  for (const match of raw.matchAll(MEDIA_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ type: "text", value: raw.slice(lastIndex, index) });
    }

    const media = mediaSegmentFromMatch(match);
    if (media) segments.push(media);

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
    .replace(AUDIO_TAG_PATTERN, "[audio]")
    .replace(/\s+/g, " ")
    .trim();
}

export function cardMediaSnippet(url: string, alt = "image"): string {
  return `\n\n![${alt}](${url})`;
}

/** Markup that embeds an audio clip in a card field, appended on its own line. */
export function cardAudioSnippet(url: string, title?: string): string {
  const titleAttribute = title?.trim() ? ` title="${escapeHtml(title.trim())}"` : "";
  return `\n\n<audio src="${escapeHtml(url.trim())}"${titleAttribute}></audio>`;
}

function extractMediaUrls(
  kinds: ReadonlySet<"image" | "audio">,
  fields: Array<string | null | undefined>,
): string[] {
  const urls = new Set<string>();
  for (const field of fields) {
    if (!field) continue;
    for (const segment of parseCardContent(field)) {
      if (segment.type !== "text" && kinds.has(segment.type)) urls.add(segment.src);
    }
  }
  return [...urls];
}

const IMAGE_KINDS: ReadonlySet<"image" | "audio"> = new Set(["image"]);
const AUDIO_KINDS: ReadonlySet<"image" | "audio"> = new Set(["audio"]);
const ALL_MEDIA_KINDS: ReadonlySet<"image" | "audio"> = new Set(["image", "audio"]);

/** Image URLs only; image-occlusion and the image transform helpers rely on this. */
export function extractCardMediaUrls(
  ...fields: Array<string | null | undefined>
): string[] {
  return extractMediaUrls(IMAGE_KINDS, fields);
}

export function extractCardAudioUrls(
  ...fields: Array<string | null | undefined>
): string[] {
  return extractMediaUrls(AUDIO_KINDS, fields);
}

/** Every media URL a card needs: images and audio clips. */
export function extractAllCardMediaUrls(
  ...fields: Array<string | null | undefined>
): string[] {
  return extractMediaUrls(ALL_MEDIA_KINDS, fields);
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
    // Anki plays audio through its own [sound:file] tag, not <audio>.
    if (/^<audio/i.test(match)) {
      return `[sound:${filename}]`;
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

/**
 * The words a text-to-speech voice should read for a card field: media tags
 * removed, cloze deletions unwrapped to their answers, HTML and Markdown
 * markup stripped, LaTeX left as its source text.
 */
export function cardTextForSpeech(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/<img[^>]*>/gi, " ")
    .replace(AUDIO_TAG_PATTERN, " ")
    .replace(/\{\{c\d+::([\s\S]*?)(?:::[\s\S]*?)?\}\}/g, "$1")
    .replace(/<br\s*\/?>|<\/(?:p|div|li|h[1-6]|blockquote|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/(\*\*|__|~~|`)/g, "")
    .replace(/(?<!\w)[*_](?=\S)|(?<=\S)[*_](?!\w)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}
