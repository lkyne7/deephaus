import os from "node:os";
import { imageSize } from "image-size";
import { createWorker, PSM } from "tesseract.js";
import { createOcclusionRectId, type OcclusionRect } from "@deephaus/shared";

/**
 * OCR-based occlusion detection.
 *
 * General vision models (gpt-4o, etc.) recognise label text well but place
 * bounding boxes imprecisely. For image-occlusion the regions ARE text, so an
 * OCR engine — which reports pixel-exact word boxes — gives boxes that land
 * directly on the labels. We detect at the word level using sparse-text page
 * segmentation (best for scattered diagram labels), keep label-like words, and
 * let the user curate which become study cards in the editor.
 */

// Minimal shape of the Tesseract page tree we traverse (kept local so we don't
// depend on exact tesseract.js type exports across versions).
type OcrBBox = { x0: number; y0: number; x1: number; y1: number };
type OcrWord = { text?: string; confidence?: number; bbox?: OcrBBox };
type OcrLine = { words?: OcrWord[] };
type OcrParagraph = { lines?: OcrLine[] };
type OcrBlock = { paragraphs?: OcrParagraph[] };
type OcrPage = { blocks?: OcrBlock[] | null };

const MIN_CONFIDENCE = 75;
const MIN_LABEL_CHARS = 3;
const MIN_ALPHA_RATIO = 0.7;
const MIN_WIDTH_FRACTION = 0.02;
const MIN_HEIGHT_FRACTION = 0.012;
const MAX_WIDTH_FRACTION = 0.45;
const MAX_HEIGHT_FRACTION = 0.12;
const MAX_REGIONS = 60;

// Common words that are rarely worth turning into a recall card on their own.
const STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "any", "can", "her",
  "was", "one", "our", "out", "his", "has", "had", "may", "its", "this", "that",
  "with", "from", "into", "than", "then", "they", "them", "their", "there",
  "which", "when", "what", "your", "also", "such", "these", "those", "been",
  "were", "will", "would", "could", "should", "between",
]);

function cleanLabel(raw: string): string {
  // Trim leading/trailing punctuation (parentheses, commas, colons, etc.).
  return raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").trim();
}

function wordToRect(
  word: OcrWord,
  imgWidth: number,
  imgHeight: number,
): OcclusionRect | null {
  const bbox = word.bbox;
  if (!bbox) return null;
  if ((word.confidence ?? 0) < MIN_CONFIDENCE) return null;

  const raw = (word.text ?? "").replace(/\s+/g, " ").trim();
  if (raw.includes("@")) return null; // emails / handles

  const label = cleanLabel(raw);
  if (label.length < MIN_LABEL_CHARS) return null;
  if (STOPWORDS.has(label.toLowerCase())) return null;

  const alpha = (label.match(/\p{L}/gu) || []).length;
  if (alpha < label.length * MIN_ALPHA_RATIO) return null;

  const width = (bbox.x1 - bbox.x0) / imgWidth;
  const height = (bbox.y1 - bbox.y0) / imgHeight;
  if (width < MIN_WIDTH_FRACTION || height < MIN_HEIGHT_FRACTION) return null;
  if (width > MAX_WIDTH_FRACTION || height > MAX_HEIGHT_FRACTION) return null;

  return {
    id: createOcclusionRectId(),
    x: bbox.x0 / imgWidth,
    y: bbox.y0 / imgHeight,
    width,
    height,
    enabled: true,
  };
}

/** Detect label-like text regions in an image using on-device OCR. */
export async function detectOcclusionRectsByOcr(image: Buffer): Promise<OcclusionRect[]> {
  const dims = imageSize(image);
  const imgWidth = dims.width ?? 0;
  const imgHeight = dims.height ?? 0;
  if (!imgWidth || !imgHeight) return [];

  const worker = await createWorker("eng", undefined, { cachePath: os.tmpdir() });
  try {
    // Sparse-text mode finds scattered labels (e.g. anatomy callouts) without
    // forcing them into full-width column lines.
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    const { data } = await worker.recognize(image, {}, { blocks: true });

    const rects: OcclusionRect[] = [];
    for (const block of (data as unknown as OcrPage).blocks ?? []) {
      for (const paragraph of block.paragraphs ?? []) {
        for (const line of paragraph.lines ?? []) {
          for (const word of line.words ?? []) {
            const rect = wordToRect(word, imgWidth, imgHeight);
            if (rect) rects.push(rect);
            if (rects.length >= MAX_REGIONS) return rects;
          }
        }
      }
    }
    return rects;
  } finally {
    await worker.terminate();
  }
}
