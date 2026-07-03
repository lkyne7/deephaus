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
 * segmentation (best for scattered diagram labels), merge adjacent words on the
 * same line into multi-word labels (e.g. "Left ventricle"), and let the user
 * curate which become study cards in the editor.
 */

// Minimal shape of the Tesseract page tree we traverse (kept local so we don't
// depend on exact tesseract.js type exports across versions).
type OcrBBox = { x0: number; y0: number; x1: number; y1: number };
type OcrWord = { text?: string; confidence?: number; bbox?: OcrBBox };
type OcrLine = { words?: OcrWord[] };
type OcrParagraph = { lines?: OcrLine[] };
type OcrBlock = { paragraphs?: OcrParagraph[] };
type OcrPage = { blocks?: OcrBlock[] | null };

const MIN_CONFIDENCE = 70;
const MIN_LABEL_CHARS = 3;
const MIN_ALPHA_RATIO = 0.6;
const MIN_WIDTH_FRACTION = 0.02;
const MIN_HEIGHT_FRACTION = 0.012;
const MAX_WIDTH_FRACTION = 0.6;
const MAX_HEIGHT_FRACTION = 0.14;
const MAX_REGIONS = 60;
/** Cap merged phrase length so a whole caption sentence never becomes one box. */
const MAX_LABEL_WORDS = 4;

// Common words that are rarely worth turning into a recall card on their own.
const STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "any", "can", "her",
  "was", "one", "our", "out", "his", "has", "had", "may", "its", "this", "that",
  "with", "from", "into", "than", "then", "they", "them", "their", "there",
  "which", "when", "what", "your", "also", "such", "these", "those", "been",
  "were", "will", "would", "could", "should", "between", "fig", "figure",
]);

function cleanLabel(raw: string): string {
  // Trim leading/trailing punctuation (parentheses, commas, colons, etc.).
  return raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").trim();
}

type QualifiedWord = { label: string; bbox: OcrBBox };

/** Keep readable, label-like words (confidence, length, mostly alphabetic). */
function qualifyWord(word: OcrWord): QualifiedWord | null {
  const bbox = word.bbox;
  if (!bbox) return null;
  if ((word.confidence ?? 0) < MIN_CONFIDENCE) return null;

  const raw = (word.text ?? "").replace(/\s+/g, " ").trim();
  if (!raw || raw.includes("@")) return null; // emails / handles

  const label = cleanLabel(raw);
  if (label.length < MIN_LABEL_CHARS) return null;

  const alpha = (label.match(/\p{L}/gu) || []).length;
  if (alpha < label.length * MIN_ALPHA_RATIO) return null;

  return { label, bbox };
}

function unionBBox(a: OcrBBox, b: OcrBBox): OcrBBox {
  return {
    x0: Math.min(a.x0, b.x0),
    y0: Math.min(a.y0, b.y0),
    x1: Math.max(a.x1, b.x1),
    y1: Math.max(a.y1, b.y1),
  };
}

type RegionGroup = { label: string; bbox: OcrBBox; words: number };

/**
 * Merge consecutive qualifying words on one line into label phrases. Words are
 * joined when the horizontal gap between them is small relative to their height
 * (i.e. they read as one phrase), up to MAX_LABEL_WORDS.
 */
function mergeLineWords(words: QualifiedWord[]): RegionGroup[] {
  const groups: RegionGroup[] = [];
  let current: RegionGroup | null = null;

  for (const word of words) {
    const height = word.bbox.y1 - word.bbox.y0;
    const gapLimit = height * 0.9;
    if (
      current &&
      current.words < MAX_LABEL_WORDS &&
      word.bbox.x0 - current.bbox.x1 <= gapLimit
    ) {
      current.bbox = unionBBox(current.bbox, word.bbox);
      current.label = `${current.label} ${word.label}`;
      current.words += 1;
    } else {
      if (current) groups.push(current);
      current = { label: word.label, bbox: { ...word.bbox }, words: 1 };
    }
  }
  if (current) groups.push(current);
  return groups;
}

function groupToRect(
  group: RegionGroup,
  imgWidth: number,
  imgHeight: number,
): OcclusionRect | null {
  // Drop single-word regions that are just a stopword (e.g. a stray "and").
  if (group.words === 1 && STOPWORDS.has(group.label.toLowerCase())) return null;

  const width = (group.bbox.x1 - group.bbox.x0) / imgWidth;
  const height = (group.bbox.y1 - group.bbox.y0) / imgHeight;
  if (width < MIN_WIDTH_FRACTION || height < MIN_HEIGHT_FRACTION) return null;
  if (width > MAX_WIDTH_FRACTION || height > MAX_HEIGHT_FRACTION) return null;

  return {
    id: createOcclusionRectId(),
    x: group.bbox.x0 / imgWidth,
    y: group.bbox.y0 / imgHeight,
    width,
    height,
    label: group.label,
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
          const qualified = (line.words ?? [])
            .map(qualifyWord)
            .filter((w): w is QualifiedWord => w !== null);
          for (const group of mergeLineWords(qualified)) {
            const rect = groupToRect(group, imgWidth, imgHeight);
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
