import { chunkPdfPages, chunkText, type SourceType, type TextChunk } from "@deephaus/shared";

export type SourceChunkPreview = {
  index: number;
  sourceRef: string;
  preview: string;
  charCount: number;
  /** Human-readable segment label (e.g. "Page 3", "Slide 5"). */
  label?: string;
  /** Data URL thumbnail for document pages/slides. */
  thumbnailUrl?: string;
  pageStart?: number;
  pageEnd?: number;
};

const PREVIEW_CHARS = 160;

/** Parse `PDF::Page3` or `Slides::Page3-5` style refs from chunkPdfPages. */
export function parseSegmentPageRange(
  sourceRef: string,
): { start: number; end: number } | null {
  const match = sourceRef.match(/::Page(\d+)(?:-(\d+))?$/);
  if (!match) return null;
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : start;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { start, end: Math.max(start, end) };
}

export function formatSegmentLabel(
  sourceRef: string,
  sourceType?: SourceType,
): string {
  const range = parseSegmentPageRange(sourceRef);
  if (range) {
    const unit =
      sourceRef.startsWith("Slides::") || sourceType === "pptx" ? "Slide" : "Page";
    if (range.start === range.end) return `${unit} ${range.start}`;
    return `${unit}s ${range.start}–${range.end}`;
  }

  const chunkMatch = sourceRef.match(/::Chunk(\d+)$/);
  if (chunkMatch) return `Section ${chunkMatch[1]}`;

  return sourceRef.replace("::", " · ");
}

export function collectSegmentPageNumbers(chunks: SourceChunkPreview[]): number[] {
  const pages = new Set<number>();
  for (const chunk of chunks) {
    const range = parseSegmentPageRange(chunk.sourceRef);
    if (!range) continue;
    for (let page = range.start; page <= range.end; page += 1) {
      pages.add(page);
      if (pages.size >= 80) break;
    }
  }
  return [...pages].sort((a, b) => a - b);
}

export function enrichChunkPreviews(
  chunks: SourceChunkPreview[],
  thumbnails: Map<number, string>,
  sourceType?: SourceType,
): SourceChunkPreview[] {
  return chunks.map((chunk) => {
    const range = parseSegmentPageRange(chunk.sourceRef);
    const label = formatSegmentLabel(chunk.sourceRef, sourceType);
    const thumbnailUrl =
      range && thumbnails.has(range.start) ? thumbnails.get(range.start) : undefined;
    return {
      ...chunk,
      label,
      thumbnailUrl,
      pageStart: range?.start,
      pageEnd: range?.end,
    };
  });
}

export function buildSourceChunks(
  sourceType: SourceType,
  rawText: string,
): TextChunk[] {
  const text = rawText.trim();
  if (!text) return [];

  if (sourceType === "pdf") {
    const pages = splitMarkedSections(text, /--- Page \d+ ---/);
    return pages.length > 0 ? chunkPdfPages(pages, "PDF") : chunkText(text, "PDF");
  }

  if (sourceType === "pptx") {
    const slides = splitMarkedSections(text, /--- Slide \d+ ---/);
    return slides.length > 0 ? chunkPdfPages(slides, "Slides") : chunkText(text, "Slides");
  }

  if (sourceType === "video" || sourceType === "youtube") {
    const segments = splitMarkedSections(text, /--- \d+:\d{2}(?::\d{2})? ---/);
    const prefix = sourceType === "youtube" ? "YouTube" : "Video";
    return segments.length > 0 ? chunkPdfPages(segments, prefix) : chunkText(text, prefix);
  }

  const prefix =
    sourceType === "docx" ? "Document" : sourceType === "notion" ? "Notion" : "Notes";
  return chunkText(text, prefix);
}

function splitMarkedSections(rawText: string, marker: RegExp): string[] {
  return rawText
    .split(marker)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function toChunkPreviews(chunks: TextChunk[]): SourceChunkPreview[] {
  return chunks.map((chunk) => ({
    index: chunk.index,
    sourceRef: chunk.sourceRef,
    preview: truncatePreview(chunk.text),
    charCount: chunk.text.length,
    label: formatSegmentLabel(chunk.sourceRef),
  }));
}

export function filterChunksByIndices(
  chunks: TextChunk[],
  indices?: number[],
): TextChunk[] {
  if (!indices?.length) return chunks;
  const allowed = new Set(indices);
  const filtered = chunks.filter((chunk) => allowed.has(chunk.index));
  if (filtered.length === 0) {
    throw new Error("Select at least one segment to generate cards from.");
  }
  return filtered;
}

function truncatePreview(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= PREVIEW_CHARS) return normalized;
  return `${normalized.slice(0, PREVIEW_CHARS - 1)}…`;
}
