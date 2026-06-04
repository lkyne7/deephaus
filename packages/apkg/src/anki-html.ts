/**
 * Convert Anki note-field HTML into the lightweight markup DeepHaus stores.
 *
 * DeepHaus card text is mostly plain text plus:
 *   - Anki-style cloze: {{c1::answer}} / {{c1::answer::hint}}  (preserved as-is)
 *   - images as <img src="..."> or markdown ![alt](url)         (preserved/rewritten)
 *
 * Anki fields are HTML, so we down-convert: block tags become newlines, <img>
 * is kept (so media can be rewritten to a hosted URL later), `[sound:...]`
 * audio refs are dropped, remaining tags are stripped, and entities decoded.
 */

/** Anki media files are often UUIDs (with or without an image extension). */
const UUID_MEDIA_FILENAME =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\.(?:jpe?g|png|gif|webp|svg|bmp|tiff?|avif))?$/i;

const IMAGE_EXT_GROUP = "(?:jpe?g|png|gif|webp|svg|bmp|tiff?|avif)";

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  "#39": "'",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    const lower = body.toLowerCase();
    if (lower.startsWith("#x")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? safeFromCodePoint(code) : match;
    }
    if (lower.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? safeFromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[lower] ?? match;
  });
}

function safeFromCodePoint(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeCardTextWhitespace(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function mediaFilenameTokens(filename: string): string[] {
  const trimmed = filename.trim();
  if (!trimmed) return [];
  const base = trimmed.replace(/\.[^.]+$/i, "");
  return base === trimmed ? [trimmed] : [trimmed, base];
}

/**
 * Remove bare Anki media filenames left as plain text after HTML conversion.
 * Anki often duplicates the bundled filename next to `<img>` tags.
 */
export function stripAnkiMediaFilenameArtifacts(
  text: string,
  knownFilenames?: ReadonlySet<string>,
): string {
  if (!text) return "";

  const dangling = new Set<string>();
  for (const name of knownFilenames ?? []) {
    for (const token of mediaFilenameTokens(name)) {
      dangling.add(token);
    }
  }

  const lines = text.split("\n");
  const kept: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      kept.push("");
      continue;
    }

    if (UUID_MEDIA_FILENAME.test(trimmed) || dangling.has(trimmed)) {
      continue;
    }

    let cleaned = line;
    if (dangling.size > 0) {
      for (const token of dangling) {
        if (!token) continue;
        const re = new RegExp(`\\s+${escapeRegExp(token)}\\s*$`, "i");
        cleaned = cleaned.replace(re, "");
      }
    }
    cleaned = cleaned.replace(
      new RegExp(
        `\\s+[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\\.${IMAGE_EXT_GROUP})?\\s*$`,
        "i",
      ),
      "",
    );

    if (cleaned.trim()) kept.push(cleaned);
  }

  return normalizeCardTextWhitespace(kept.join("\n"));
}

/** Pull the `src` filename out of an <img> tag. */
function imgSrc(tag: string): string | null {
  const match = tag.match(/\bsrc\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
  if (!match) return null;
  const raw = (match[2] ?? match[3] ?? match[4] ?? "").trim();
  return raw || null;
}

/**
 * Down-convert one Anki field's HTML to DeepHaus card text. Images become
 * canonical `<img src="filename">` markers that {@link rewriteMediaRefs} can
 * later point at hosted URLs.
 */
export function ankiFieldToText(html: string | null | undefined): string {
  if (!html) return "";

  let out = html.replace(/\r\n/g, "\n");

  // Preserve images as a canonical, attribute-free marker.
  out = out.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = imgSrc(tag);
    return src ? `\u0001IMG:${src}\u0001` : "";
  });

  // Drop audio/video sound references entirely.
  out = out.replace(/\[sound:[^\]]*\]/gi, "");
  out = out.replace(/<(audio|video|source)\b[^>]*>/gi, "");
  out = out.replace(/<\/(audio|video)>/gi, "");

  // Block-level tags become line breaks.
  out = out.replace(/<\s*br\s*\/?\s*>/gi, "\n");
  out = out.replace(/<\/(p|div|li|tr|h[1-6]|blockquote)\s*>/gi, "\n");
  out = out.replace(/<\s*(p|div|li|tr|h[1-6]|blockquote)\b[^>]*>/gi, "\n");

  // Strip every remaining tag (styling, spans, anchors, tables …).
  out = out.replace(/<[^>]+>/g, "");

  out = decodeEntities(out);

  // Restore image markers as canonical tags.
  out = out.replace(/\u0001IMG:([^\u0001]*)\u0001/g, (_m, src: string) => `<img src="${src}">`);

  return stripAnkiMediaFilenameArtifacts(out);
}

/** Media filenames referenced by `<img src="...">` in DeepHaus card text. */
export function extractMediaFilenames(...fields: Array<string | null | undefined>): string[] {
  const names = new Set<string>();
  for (const field of fields) {
    if (!field) continue;
    for (const match of field.matchAll(/<img\s+src=["']([^"']+)["'][^>]*>/gi)) {
      const name = decodeEntities(match[1].trim());
      // Only local (apkg-bundled) filenames — leave hosted URLs untouched.
      if (name && !/^https?:\/\//i.test(name)) names.add(name);
    }
  }
  return [...names];
}

/** Rewrite local `<img src="filename">` refs to hosted URLs (markdown form). */
export function rewriteMediaRefs(
  text: string | null | undefined,
  filenameToUrl: ReadonlyMap<string, string>,
): string {
  if (!text) return "";
  const rewritten = text.replace(/<img\s+src=["']([^"']+)["'][^>]*>/gi, (match, rawName: string) => {
    const name = decodeEntities(rawName.trim());
    if (/^https?:\/\//i.test(name)) return match;
    const url = filenameToUrl.get(name);
    return url ? `![image](${url})` : "";
  });
  return stripAnkiMediaFilenameArtifacts(rewritten, new Set(filenameToUrl.keys()));
}
