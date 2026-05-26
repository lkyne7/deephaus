import type { TextChunk } from "./schemas.js";
import { CHUNK_OVERLAP_CHARS, CHUNK_TARGET_CHARS } from "./schemas.js";

/** Hard-split text that exceeds the target size (e.g. PDFs with no paragraph breaks). */
export function splitOversizedText(text: string, maxChars = CHUNK_TARGET_CHARS): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxChars) return [trimmed];

  const parts: string[] = [];
  let start = 0;
  while (start < trimmed.length) {
    let end = Math.min(start + maxChars, trimmed.length);
    if (end < trimmed.length) {
      const slice = trimmed.slice(start, end);
      const lastBreak = Math.max(slice.lastIndexOf("\n"), slice.lastIndexOf(" "));
      if (lastBreak > maxChars * 0.4) {
        end = start + lastBreak;
      }
    }
    const piece = trimmed.slice(start, end).trim();
    if (piece) parts.push(piece);
    start = Math.max(start + 1, end);
  }
  return parts;
}

export function chunkText(text: string, sourcePrefix = "Notes"): TextChunk[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const paragraphs = normalized.split(/\n{2,}/).flatMap((paragraph) =>
    splitOversizedText(paragraph),
  );
  const chunks: TextChunk[] = [];
  let buffer = "";
  let chunkIndex = 0;

  const flush = () => {
    const trimmed = buffer.trim();
    if (!trimmed) return;
    chunks.push({
      text: trimmed,
      sourceRef: `${sourcePrefix}::Chunk${chunkIndex + 1}`,
      index: chunkIndex,
    });
    chunkIndex += 1;
    const overlap = trimmed.slice(-CHUNK_OVERLAP_CHARS);
    buffer = overlap ? `${overlap}\n\n` : "";
  };

  for (const paragraph of paragraphs) {
    const candidate = buffer ? `${buffer}${paragraph}` : paragraph;
    if (candidate.length > CHUNK_TARGET_CHARS && buffer.trim()) {
      flush();
      buffer = paragraph;
    } else {
      buffer = candidate;
      if (!buffer.includes("\n\n") && buffer.length < CHUNK_TARGET_CHARS) {
        buffer += "\n\n";
      }
    }
  }

  if (buffer.trim()) flush();
  return chunks;
}

export function chunkPdfPages(
  pages: string[],
  sourcePrefix = "PDF",
): TextChunk[] {
  const chunks: TextChunk[] = [];
  let buffer = "";
  let chunkIndex = 0;
  let startPage = 1;

  const flush = (endPage: number) => {
    const trimmed = buffer.trim();
    if (!trimmed) return;
    const ref =
      startPage === endPage
        ? `${sourcePrefix}::Page${startPage}`
        : `${sourcePrefix}::Page${startPage}-${endPage}`;
    chunks.push({ text: trimmed, sourceRef: ref, index: chunkIndex });
    chunkIndex += 1;
    buffer = trimmed.slice(-CHUNK_OVERLAP_CHARS);
    startPage = endPage;
  };

  pages.forEach((pageText, i) => {
    const pageNum = i + 1;
    for (const pagePart of splitOversizedText(pageText)) {
      appendPageSection(pagePart, pageNum);
    }
  });

  if (buffer.trim()) flush(pages.length);
  return chunks;

  function appendPageSection(pagePart: string, pageNum: number) {
    const section = `\n\n--- Page ${pageNum} ---\n\n${pagePart.trim()}`;
    if ((buffer + section).length > CHUNK_TARGET_CHARS && buffer.trim()) {
      flush(pageNum - 1 || pageNum);
      startPage = pageNum;
      buffer = section;
    } else {
      buffer += section;
    }
  }
}

export function normalizeCardText(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

export function deduplicateCards<T extends { type: string; front?: string | null; back?: string | null; cloze_text?: string | null; clozeText?: string | null }>(
  cards: T[],
): T[] {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const card of cards) {
    const key =
      card.type === "basic"
        ? normalizeCardText(`${card.front ?? ""}|${card.back ?? ""}`)
        : normalizeCardText(card.cloze_text ?? card.clozeText ?? "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(card);
  }

  return result;
}

export function validateClozeDeletions(clozeText: string): boolean {
  const matches = [...clozeText.matchAll(/\{\{c(\d+)::/g)];
  if (matches.length === 0) return false;
  const numbers = matches.map((m) => Number(m[1]));
  return Math.max(...numbers) <= 3;
}

/** Unique cloze ordinals (1–9) present in Anki-style cloze markdown. */
export function extractClozeOrdinals(clozeText: string | null | undefined): number[] {
  if (!clozeText) return [];
  const ords = new Set<number>();
  for (const match of clozeText.matchAll(/\{\{c(\d+)::/gi)) {
    const n = Number(match[1]);
    if (Number.isFinite(n) && n >= 1 && n <= 9) ords.add(n);
  }
  return [...ords].sort((a, b) => a - b);
}

export function studyQueueKey(cardId: string, clozeOrd: number | null | undefined): string {
  return clozeOrd != null && clozeOrd > 0 ? `${cardId}:c${clozeOrd}` : cardId;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
