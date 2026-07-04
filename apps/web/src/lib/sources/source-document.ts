import "server-only";
import type { JSONContent } from "@tiptap/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SourceType } from "@deephaus/shared";
import { emptySourceDoc } from "@deephaus/rich-text";
import { extractDocxHtml } from "@/lib/docx/extract-html";
import { extractPdfRich, type RichBlock, type RichRun } from "@/lib/pdf/extract-rich";
import { extractPptxRich, type PptxRun } from "@/lib/pptx/extract-rich";
import { extractSourceFromFile } from "@/lib/sources/extract-source";
import { htmlToSourceDoc } from "@/lib/sources/html-to-doc";
import { extensionForMime, uploadSourceMedia } from "@/lib/sources/source-media";

const SOURCE_FILE_BUCKET = "pdfs";
/** Bound how many images we inline so a huge deck never explodes the document. */
const MAX_INLINE_IMAGES = 60;

type SourceRecord = {
  id: string;
  type: SourceType;
  raw_text: string | null;
  storage_path: string | null;
  /** Inline images from the original document into the editable notes. */
  extract_images?: boolean | null;
};

// --- ProseMirror node builders ---------------------------------------------

function textNode(text: string): JSONContent {
  return { type: "text", text };
}

/** Text nodes with bold/italic marks from extracted style runs. */
function runNodes(runs: (RichRun | PptxRun)[]): JSONContent[] {
  const out: JSONContent[] = [];
  for (const run of runs) {
    if (!run.text) continue;
    const marks: JSONContent["marks"] = [];
    if (run.bold) marks.push({ type: "bold" });
    if (run.italic) marks.push({ type: "italic" });
    out.push({ type: "text", text: run.text, ...(marks.length ? { marks } : {}) });
  }
  return out;
}

function paragraph(text: string): JSONContent {
  return text
    ? { type: "paragraph", content: [textNode(text)] }
    : { type: "paragraph" };
}

function runParagraph(runs: (RichRun | PptxRun)[]): JSONContent | null {
  const content = runNodes(runs);
  return content.length ? { type: "paragraph", content } : null;
}

function heading(text: string, level = 2): JSONContent {
  return { type: "heading", attrs: { level }, content: [textNode(text)] };
}

function runHeading(runs: (RichRun | PptxRun)[], level: number): JSONContent | null {
  // Headings drop inline styling — the heading itself carries the emphasis.
  const text = runs.map((r) => r.text).join("").replace(/\s+/g, " ").trim();
  return text ? heading(text, Math.min(3, Math.max(1, level))) : null;
}

function bulletList(items: (RichRun | PptxRun)[][]): JSONContent | null {
  const listItems: JSONContent[] = [];
  for (const runs of items) {
    const para = runParagraph(runs);
    if (para) listItems.push({ type: "listItem", content: [para] });
  }
  return listItems.length ? { type: "bulletList", content: listItems } : null;
}

function imageNode(src: string, alt: string): JSONContent {
  return { type: "image", attrs: { src, alt, title: alt || null } };
}

function doc(content: JSONContent[]): JSONContent {
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

// --- Plain-text → structured blocks ----------------------------------------

/** Recognize the `--- Page N ---` / `--- Slide N ---` / `--- M:SS ---` markers. */
function parseMarkerLine(line: string): string | null {
  const trimmed = line.trim();
  const pageOrSlide = trimmed.match(/^---\s*(page|slide)\s+(\d+)\s*---$/i);
  if (pageOrSlide) {
    const unit = pageOrSlide[1]!.toLowerCase() === "slide" ? "Slide" : "Page";
    return `${unit} ${pageOrSlide[2]}`;
  }
  const timestamp = trimmed.match(/^---\s*(\d+:\d{2}(?::\d{2})?)\s*---$/);
  if (timestamp) return timestamp[1]!;
  return null;
}

/**
 * Turn marker-annotated extracted text into heading + paragraph blocks. Marker
 * lines become headings (so page/slide structure is visible and editable);
 * blank lines split paragraphs; single newlines inside a paragraph collapse to
 * spaces for clean, Notion-like blocks.
 */
function textToBlocks(text: string): JSONContent[] {
  const normalized = (text ?? "").replace(/\r\n/g, "\n").trim();
  if (!normalized) return [{ type: "paragraph" }];

  const blocks: JSONContent[] = [];
  let pending: string[] = [];

  const flush = () => {
    if (pending.length === 0) return;
    const joined = pending.join(" ").replace(/\s+/g, " ").trim();
    if (joined) blocks.push(paragraph(joined));
    pending = [];
  };

  for (const line of normalized.split("\n")) {
    const marker = parseMarkerLine(line);
    if (marker) {
      flush();
      blocks.push(heading(marker));
      continue;
    }
    if (line.trim() === "") {
      flush();
      continue;
    }
    pending.push(line.trim());
  }
  flush();

  return blocks.length ? blocks : [{ type: "paragraph" }];
}

// --- PDF: rich text + inline figures ----------------------------------------

/**
 * Build a PDF document with real structure: per-page "Page N" markers (needed
 * for card↔source linking), headings/bold/italic/bullets recovered from the
 * PDF's fonts, and embedded figures uploaded + placed where they appear.
 */
async function buildPdfDocument(
  supabase: SupabaseClient,
  userId: string,
  source: SourceRecord,
  buffer: Buffer,
  includeImages: boolean,
): Promise<JSONContent | null> {
  const rich = await extractPdfRich(buffer, {
    includeImages,
    maxImages: MAX_INLINE_IMAGES,
  });

  const textChars = rich.pages
    .flatMap((p) => p.blocks)
    .reduce((sum, block) => {
      if (block.kind === "image") return sum;
      if (block.kind === "bullets") {
        return sum + block.items.flat().reduce((s, r) => s + r.text.length, 0);
      }
      return sum + block.runs.reduce((s, r) => s + r.text.length, 0);
    }, 0);
  // Scanned/empty PDFs: let the caller fall back to the plain-text path.
  if (textChars < 40) return null;

  const out: JSONContent[] = [];
  let uploaded = 0;

  for (const page of rich.pages) {
    out.push(heading(`Page ${page.pageNumber}`));
    let imageIndex = 0;
    for (const block of page.blocks) {
      if (block.kind === "image") {
        if (uploaded >= MAX_INLINE_IMAGES) continue;
        const name = `page${page.pageNumber}-${imageIndex}.${extensionForMime(block.mime)}`;
        imageIndex += 1;
        const url = await uploadSourceMedia(
          supabase,
          userId,
          source.id,
          name,
          block.bytes,
          block.mime,
        );
        if (url) {
          out.push(imageNode(url, `Page ${page.pageNumber}`));
          uploaded += 1;
        }
        continue;
      }
      const node =
        block.kind === "heading"
          ? runHeading(block.runs, block.level)
          : block.kind === "bullets"
            ? bulletList(block.items)
            : runParagraph(block.runs);
      if (node) out.push(node);
    }
  }

  return out.length > 0 ? doc(out) : null;
}

// --- PPTX: per-slide structured content ---------------------------------------

/**
 * Build a PPTX document: "Slide N" markers, the slide title as a heading, body
 * text as bullet lists / paragraphs with bold+italic, and slide pictures placed
 * by their position on the slide.
 */
async function buildPptxDocument(
  supabase: SupabaseClient,
  userId: string,
  source: SourceRecord,
  buffer: Buffer,
  includeImages: boolean,
): Promise<JSONContent | null> {
  const slides = await extractPptxRich(buffer, { includeImages });
  if (slides.length === 0) return null;

  const out: JSONContent[] = [];
  let uploaded = 0;

  for (const slide of slides) {
    out.push(heading(`Slide ${slide.slideNumber}`));
    let imageIndex = 0;
    let bulletRun: PptxRun[][] = [];

    const flushBullets = () => {
      if (bulletRun.length === 0) return;
      const list = bulletList(bulletRun);
      if (list) out.push(list);
      bulletRun = [];
    };

    for (const item of slide.items) {
      if (item.kind === "image") {
        flushBullets();
        if (uploaded >= MAX_INLINE_IMAGES) continue;
        const name = `slide${slide.slideNumber}-${imageIndex}.${extensionForMime(item.mime)}`;
        imageIndex += 1;
        const url = await uploadSourceMedia(
          supabase,
          userId,
          source.id,
          name,
          item.bytes,
          item.mime,
        );
        if (url) {
          out.push(imageNode(url, `Slide ${slide.slideNumber}`));
          uploaded += 1;
        }
        continue;
      }

      if (item.kind === "title") {
        flushBullets();
        const node = runHeading(item.runs, 3);
        if (node) out.push(node);
        continue;
      }

      for (const para of item.paragraphs) {
        if (para.bullet) {
          bulletRun.push(para.runs);
        } else {
          flushBullets();
          const node = runParagraph(para.runs);
          if (node) out.push(node);
        }
      }
    }
    flushBullets();
  }

  return out.length > 0 ? doc(out) : null;
}

async function downloadOriginal(
  supabase: SupabaseClient,
  storagePath: string,
): Promise<Buffer | null> {
  try {
    const { data } = await supabase.storage.from(SOURCE_FILE_BUCKET).download(storagePath);
    if (!data) return null;
    return Buffer.from(await data.arrayBuffer());
  } catch (err) {
    console.warn("[source-document] original download failed:", err);
    return null;
  }
}

function fileNameFromPath(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/^\d+-/, "");
}

export type BuiltSourceDocument = {
  content: JSONContent;
  /** Text used to build the doc; non-null when re-extracted so callers can heal raw_text. */
  rawText: string | null;
};

/**
 * Build the editable document for a source the first time it's opened. PDF,
 * DOCX and PPTX are rebuilt from the original file with formatting (headings,
 * bold/italic, lists) and — unless the source opted out — inline images placed
 * where they appear. Everything else is structured text. If raw_text is missing
 * but the original file is stored, the text is re-extracted (self-healing).
 * Best-effort — always returns a valid doc.
 */
export async function buildSourceDocument(
  supabase: SupabaseClient,
  userId: string,
  source: SourceRecord,
): Promise<BuiltSourceDocument> {
  let rawText = (source.raw_text ?? "").trim();
  const needsReextract = !rawText && Boolean(source.storage_path);
  const includeImages = source.extract_images !== false;
  const wantBuffer =
    Boolean(source.storage_path) &&
    (source.type === "docx" ||
      source.type === "pptx" ||
      source.type === "pdf" ||
      needsReextract);

  let buffer: Buffer | null = null;
  if (wantBuffer && source.storage_path) {
    buffer = await downloadOriginal(supabase, source.storage_path);
  }

  // Self-heal: rebuild the extracted text from the original file when missing.
  if (needsReextract && buffer && source.storage_path) {
    try {
      const extracted = await extractSourceFromFile(
        buffer,
        fileNameFromPath(source.storage_path),
        "",
        { skipVideoTranscription: true },
      );
      rawText = (extracted.text ?? "").trim();
    } catch (err) {
      console.warn("[source-document] re-extract failed:", err);
    }
  }

  try {
    if (buffer && source.type === "docx") {
      const html = await extractDocxHtml(buffer, (bytes, mime) => {
        if (!includeImages) return Promise.resolve(null);
        const name = `docx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extensionForMime(mime)}`;
        return uploadSourceMedia(supabase, userId, source.id, name, bytes, mime);
      });
      if (html) {
        const json = htmlToSourceDoc(html);
        if (Array.isArray(json.content) && json.content.length > 0) {
          return { content: json, rawText: rawText || null };
        }
      }
    }

    if (buffer && source.type === "pptx") {
      const content = await buildPptxDocument(supabase, userId, source, buffer, includeImages);
      if (content) return { content, rawText: rawText || null };
    }

    if (buffer && source.type === "pdf") {
      const content = await buildPdfDocument(supabase, userId, source, buffer, includeImages);
      if (content) return { content, rawText: rawText || null };
    }
  } catch (err) {
    console.warn("[source-document] rich build failed, falling back to text:", err);
  }

  // Text, video, youtube, topic — plus any document whose rich build failed.
  const blocks = textToBlocks(rawText);
  return {
    content: blocks.length ? doc(blocks) : emptySourceDoc(),
    rawText: rawText || null,
  };
}
