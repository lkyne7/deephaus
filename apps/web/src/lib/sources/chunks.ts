import { chunkPdfPages, chunkText, type SourceType, type TextChunk } from "@deephaus/shared";

export type SourceChunkPreview = {
  index: number;
  sourceRef: string;
  preview: string;
  charCount: number;
};

const PREVIEW_CHARS = 160;

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

  const prefix = sourceType === "docx" ? "Document" : "Notes";
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
