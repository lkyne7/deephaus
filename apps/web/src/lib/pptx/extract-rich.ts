import "server-only";

/**
 * Rich PPTX extraction for the editable source document.
 *
 * The plain-text extractor collapses each slide to one line. This re-reads the
 * slide XML to recover structure: the title placeholder (as a heading), body
 * paragraphs with bold/italic runs and bullet flags, and embedded pictures —
 * all ordered by their vertical position on the slide so images land next to
 * the text they belong with.
 */

export type PptxRun = { text: string; bold?: boolean; italic?: boolean };

export type PptxParagraph = { runs: PptxRun[]; bullet: boolean };

export type PptxSlideItem =
  | { kind: "title"; runs: PptxRun[]; y: number }
  | { kind: "text"; paragraphs: PptxParagraph[]; y: number }
  | { kind: "image"; bytes: Buffer; mime: string; y: number };

export type PptxRichSlide = { slideNumber: number; items: PptxSlideItem[] };

/** Skip decorative icons/bullets when inlining slide images. */
const MIN_IMAGE_DIMENSION = 120;

// Placeholder types that never carry note-worthy content.
const SKIP_PLACEHOLDERS = new Set(["sldnum", "dt", "ftr"]);

function slideNumberFromPath(path: string): number {
  const match = path.match(/slide(\d+)\.xml$/);
  return match ? Number(match[1]) : 0;
}

function mimeFromName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    case "svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
}

function shapeOffsetY(xml: string): number {
  const match = xml.match(/<a:off x="-?\d+" y="(-?\d+)"/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function placeholderType(xml: string): string | null {
  const match = xml.match(/<p:ph\b[^>]*\btype="([^"]+)"/);
  return match ? match[1]!.toLowerCase() : null;
}

function isPlaceholder(xml: string): boolean {
  return /<p:ph\b/.test(xml);
}

/** Parse the runs of one `<a:p>` paragraph, skipping field runs (slide numbers). */
function parseRuns(paragraphXml: string): PptxRun[] {
  const runs: PptxRun[] = [];
  const withoutFields = paragraphXml.replace(/<a:fld\b[\s\S]*?<\/a:fld>/g, "");
  for (const match of withoutFields.matchAll(/<a:r>([\s\S]*?)<\/a:r>/g)) {
    const runXml = match[1]!;
    const textMatch = runXml.match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/);
    if (!textMatch) continue;
    const text = decodeXmlEntities(textMatch[1] ?? "");
    if (!text) continue;
    const propsMatch = runXml.match(/<a:rPr\b([^>]*)>/);
    const props = propsMatch?.[1] ?? "";
    const bold = /\bb="1"/.test(props);
    const italic = /\bi="1"/.test(props);
    const last = runs[runs.length - 1];
    if (last && Boolean(last.bold) === bold && Boolean(last.italic) === italic) {
      last.text += text;
    } else {
      runs.push({ text, bold: bold || undefined, italic: italic || undefined });
    }
  }
  return runs;
}

/** Split a text body into paragraphs with bullet flags. */
function parseParagraphs(shapeXml: string, defaultBullet: boolean): PptxParagraph[] {
  const paragraphs: PptxParagraph[] = [];
  for (const match of shapeXml.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)) {
    const paragraphXml = match[1]!;
    const runs = parseRuns(paragraphXml);
    if (runs.length === 0) continue;
    const beforeFirstRun = paragraphXml.split("<a:r>")[0] ?? "";
    const noBullet = /<a:buNone/.test(beforeFirstRun);
    paragraphs.push({ runs, bullet: defaultBullet && !noBullet });
  }
  return paragraphs;
}

/** Flatten a slide table (graphicFrame) into one plain paragraph per row. */
function parseTableParagraphs(frameXml: string): PptxParagraph[] {
  const rows: PptxParagraph[] = [];
  for (const rowMatch of frameXml.matchAll(/<a:tr\b[\s\S]*?<\/a:tr>/g)) {
    const cells: string[] = [];
    for (const cellMatch of rowMatch[0]!.matchAll(/<a:tc\b[\s\S]*?<\/a:tc>/g)) {
      const text = [...cellMatch[0]!.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)]
        .map((m) => decodeXmlEntities(m[1] ?? ""))
        .join("")
        .trim();
      if (text) cells.push(text);
    }
    if (cells.length > 0) {
      rows.push({ runs: [{ text: cells.join(" · ") }], bullet: false });
    }
  }
  return rows;
}

type PptxRels = Map<string, string>;

async function loadRels(zip: import("jszip"), relsPath: string): Promise<PptxRels> {
  const out: PptxRels = new Map();
  const relsFile = zip.file(relsPath);
  if (!relsFile) return out;
  const relsXml = await relsFile.async("text");
  for (const match of relsXml.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    const target = match[2]!;
    if (target.includes("../media/")) {
      out.set(match[1]!, target.replace("../", "ppt/"));
    }
  }
  return out;
}

async function loadPicture(
  zip: import("jszip"),
  rels: PptxRels,
  picXml: string,
): Promise<{ bytes: Buffer; mime: string } | null> {
  const embedMatch = picXml.match(/r:embed="([^"]+)"/);
  if (!embedMatch) return null;
  const mediaPath = rels.get(embedMatch[1]!);
  if (!mediaPath) return null;
  const mediaFile = zip.file(mediaPath);
  if (!mediaFile) return null;
  const mime = mimeFromName(mediaPath);
  if (!mime.startsWith("image/") || mime === "image/svg+xml") return null;

  const bytes = Buffer.from(await mediaFile.async("arraybuffer"));
  try {
    const { imageSize } = await import("image-size");
    const dims = imageSize(bytes);
    if (
      (dims.width ?? 0) < MIN_IMAGE_DIMENSION &&
      (dims.height ?? 0) < MIN_IMAGE_DIMENSION
    ) {
      return null;
    }
  } catch {
    // Keep images we can't measure rather than dropping silently.
  }
  return { bytes, mime };
}

/**
 * Structured, position-ordered content for every slide. Best-effort: returns an
 * empty array when the file can't be parsed, and slides without recognizable
 * content are omitted.
 */
export async function extractPptxRich(
  buffer: Buffer,
  options: { includeImages?: boolean } = {},
): Promise<PptxRichSlide[]> {
  const includeImages = options.includeImages !== false;
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);

  const slidePaths = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => slideNumberFromPath(a) - slideNumberFromPath(b));

  const slides: PptxRichSlide[] = [];

  for (let i = 0; i < slidePaths.length; i += 1) {
    const slidePath = slidePaths[i]!;
    const slideXml = await zip.file(slidePath)!.async("text");
    const relsPath = slidePath
      .replace("ppt/slides/", "ppt/slides/_rels/")
      .replace(".xml", ".xml.rels");
    const rels = await loadRels(zip, relsPath);

    const items: PptxSlideItem[] = [];
    const seenMedia = new Set<string>();

    // Shapes, pictures, and tables in document order; nesting inside groups is
    // handled by matching the leaf elements directly.
    for (const match of slideXml.matchAll(
      /<p:sp>[\s\S]*?<\/p:sp>|<p:pic>[\s\S]*?<\/p:pic>|<p:graphicFrame>[\s\S]*?<\/p:graphicFrame>/g,
    )) {
      const xml = match[0]!;
      const y = shapeOffsetY(xml);

      if (xml.startsWith("<p:graphicFrame>")) {
        const paragraphs = parseTableParagraphs(xml);
        if (paragraphs.length > 0) items.push({ kind: "text", paragraphs, y });
        continue;
      }

      if (xml.startsWith("<p:pic>")) {
        if (!includeImages) continue;
        const embed = xml.match(/r:embed="([^"]+)"/)?.[1];
        if (embed && seenMedia.has(embed)) continue;
        const picture = await loadPicture(zip, rels, xml);
        if (picture) {
          if (embed) seenMedia.add(embed);
          items.push({ kind: "image", bytes: picture.bytes, mime: picture.mime, y });
        }
        continue;
      }

      const ph = placeholderType(xml);
      if (ph && SKIP_PLACEHOLDERS.has(ph)) continue;

      if (ph === "title" || ph === "ctrtitle") {
        const runs = parseRuns(xml);
        if (runs.length > 0) items.push({ kind: "title", runs, y });
        continue;
      }

      // Body/content placeholders default to bullets (that's how PowerPoint
      // renders them); free text boxes default to plain paragraphs.
      const defaultBullet = isPlaceholder(xml);
      const paragraphs = parseParagraphs(xml, defaultBullet);
      if (paragraphs.length > 0) items.push({ kind: "text", paragraphs, y });
    }

    items.sort((a, b) => a.y - b.y);
    if (items.length > 0) {
      slides.push({ slideNumber: i + 1, items });
    }
  }

  return slides;
}
