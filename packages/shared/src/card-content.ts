export type CardContentSegment =
  | { type: "text"; value: string }
  | { type: "image"; alt: string; src: string };

const MEDIA_PATTERN =
  /!\[([^\]]*)\]\(([^)]+)\)|<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi;

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

    const src = (match[2] ?? match[3] ?? "").trim();
    if (isAllowedImageSrc(src)) {
      segments.push({
        type: "image",
        alt: match[1]?.trim() || "Card image",
        src,
      });
    }

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

export function rewriteCardMediaForAnki(
  text: string | null | undefined,
  urlToFilename: ReadonlyMap<string, string>,
): string | undefined {
  if (!text) return undefined;

  let changed = false;
  let out = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt, rawUrl) => {
    const url = rawUrl.trim();
    const filename = urlToFilename.get(url);
    if (!filename) {
      changed = true;
      return "";
    }
    const altText = typeof alt === "string" ? alt.trim() : "";
    return `<img src="${filename}" alt="${escapeHtml(altText)}">`;
  });

  out = out.replace(/<img\s+[^>]*src=["']([^"']+)["'][^>]*>/gi, (_match, rawUrl) => {
    const url = rawUrl.trim();
    const filename = urlToFilename.get(url);
    if (!filename) {
      changed = true;
      return "";
    }
    return `<img src="${filename}">`;
  });

  if (!changed) return text;
  return out.replace(/\n{3,}/g, "\n\n").trim();
}
