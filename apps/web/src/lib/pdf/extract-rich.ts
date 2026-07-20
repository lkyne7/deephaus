import "server-only";
import { MAX_SOURCE_DOCUMENT_PAGES } from "@deephaus/shared";
import { loadCanvasRuntime, loadPdfjsRuntime } from "@/lib/pdf/runtime";

/**
 * Rich PDF extraction for the editable source document.
 *
 * pdf-parse (used for raw_text) flattens everything to plain text. This module
 * re-reads the PDF with pdfjs to recover:
 *  - headings (from font-size tiers relative to the body text size)
 *  - bold / italic runs (from the embedded font names)
 *  - bullet lines (from leading bullet glyphs)
 *  - embedded raster images, decoded to PNG and positioned in the page flow
 *
 * Everything is best-effort: callers fall back to the plain-text document
 * builder when this returns nothing useful.
 */

export type RichRun = { text: string; bold?: boolean; italic?: boolean };

export type RichTextBlock =
  | { kind: "heading"; level: 1 | 2 | 3; runs: RichRun[] }
  | { kind: "paragraph"; runs: RichRun[] }
  | { kind: "bullets"; items: RichRun[][] };

export type RichImageBlock = {
  kind: "image";
  bytes: Buffer;
  mime: "image/png";
  width: number;
  height: number;
};

export type RichBlock = RichTextBlock | RichImageBlock;

export type RichPdfPage = { pageNumber: number; blocks: RichBlock[] };

export type RichPdfResult = { pages: RichPdfPage[]; pageCount: number };

/** Region an embedded image occupies on a page, in PDF units, y from page top. */
export type PdfImageRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Decoded pixel dimensions of the underlying image. */
  pixelWidth: number;
  pixelHeight: number;
};

/** Skip icons/bullets; keep real figures (decoded pixel dimensions). */
const MIN_IMAGE_PIXELS = 110;
/** Guard against pathologically large embedded images. */
const MAX_IMAGE_AREA = 16_000_000;
/** Displayed coverage above this fraction of the page is a background, not a figure. */
const MAX_PAGE_COVERAGE = 0.85;
/** Minimum displayed size (PDF units ~ points) for an inline figure. */
const MIN_DISPLAY_PT = 50;

type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** apply(concat(outer, inner), p) === apply(outer, apply(inner, p)) */
function concat(o: Matrix, i: Matrix): Matrix {
  return [
    o[0] * i[0] + o[2] * i[1],
    o[1] * i[0] + o[3] * i[1],
    o[0] * i[2] + o[2] * i[3],
    o[1] * i[2] + o[3] * i[3],
    o[0] * i[4] + o[2] * i[5] + o[4],
    o[1] * i[4] + o[3] * i[5] + o[5],
  ];
}

function applyMatrix(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

// --- pdfjs plumbing ----------------------------------------------------------

type PdfjsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

async function loadPdfjs(): Promise<PdfjsModule> {
  return (await loadPdfjsRuntime()).pdfjs;
}

/** Minimal structural view of a pdfjs page (avoids deep type imports). */
type PdfPage = {
  view: number[];
  getTextContent(): Promise<{ items: unknown[]; styles: Record<string, unknown> }>;
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  objs: { get(name: string, callback?: (value: unknown) => void): unknown };
  commonObjs: { get(name: string, callback?: (value: unknown) => void): unknown };
  cleanup?: () => void;
};

type TextItem = {
  str: string;
  transform: number[];
  width: number;
  hasEOL?: boolean;
  fontName?: string;
};

function isTextItem(item: unknown): item is TextItem {
  return (
    typeof item === "object" &&
    item !== null &&
    typeof (item as TextItem).str === "string" &&
    Array.isArray((item as TextItem).transform)
  );
}

/** Resolve a pdfjs object store entry, tolerating pending/missing objects. */
function getPdfObject(page: PdfPage, name: string): Promise<unknown> {
  const store = name.startsWith("g_") ? page.commonObjs : page.objs;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 3000);
    try {
      store.get(name, (value: unknown) => {
        clearTimeout(timer);
        resolve(value);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

// --- Font styles -------------------------------------------------------------

type FontStyle = { bold: boolean; italic: boolean };

function styleFromFontName(name: string): FontStyle {
  return {
    bold: /bold|black|heavy|semibold|demibold|demi\b|extrabold|medium(?!.*regular)/i.test(name),
    italic: /italic|oblique/i.test(name),
  };
}

async function resolveFontStyles(
  page: PdfPage,
  items: TextItem[],
): Promise<Map<string, FontStyle>> {
  const styles = new Map<string, FontStyle>();
  const names = new Set<string>();
  for (const item of items) {
    if (item.fontName) names.add(item.fontName);
  }
  for (const fontName of names) {
    let style: FontStyle = { bold: false, italic: false };
    const font = (await getPdfObject(page, fontName)) as { name?: string } | null;
    if (font?.name) style = styleFromFontName(font.name);
    styles.set(fontName, style);
  }
  return styles;
}

// --- Lines -------------------------------------------------------------------

type LineRun = RichRun & { size: number };

type Line = {
  runs: LineRun[];
  /** Baseline y in PDF units (origin bottom-left). */
  y: number;
  x: number;
  maxSize: number;
  text: string;
  allBold: boolean;
  /** Preceded by an explicit empty end-of-line marker → new paragraph. */
  hardStart: boolean;
};

function itemFontSize(item: TextItem): number {
  const t = item.transform;
  return Math.hypot(t[2] ?? 0, t[3] ?? 0) || Math.abs(t[3] ?? 0) || 10;
}

/**
 * Group text items into visual lines. pdfjs emits items in content order and
 * flags line ends with `hasEOL`; we also break on significant baseline jumps
 * (some producers never set hasEOL).
 */
function buildLines(items: TextItem[], fontStyles: Map<string, FontStyle>): Line[] {
  const lines: Line[] = [];
  let current: Line | null = null;
  let prevEnd = 0;
  let breakAfterPrev = false;
  // Producers like Chrome emit a dedicated empty item with hasEOL at the start
  // of each paragraph/list item — the only reliable paragraph signal they give.
  let hardBreakPending = false;

  const flush = () => {
    if (!current) return;
    current.text = current.runs.map((r) => r.text).join("");
    const letters = current.runs.filter((r) => r.text.trim());
    current.allBold = letters.length > 0 && letters.every((r) => r.bold);
    if (current.text.trim()) lines.push(current);
    current = null;
  };

  for (const item of items) {
    // Skip heavily rotated text (vertical watermarks, axis labels) — it reads
    // as garbage when forced into the horizontal line flow.
    if (Math.abs(item.transform[1] ?? 0) > Math.abs(item.transform[0] ?? 0)) {
      continue;
    }

    const size = itemFontSize(item);
    const y = item.transform[5] ?? 0;
    const x = item.transform[4] ?? 0;
    const style = (item.fontName && fontStyles.get(item.fontName)) || {
      bold: false,
      italic: false,
    };

    if (item.str.length === 0 && item.hasEOL) {
      hardBreakPending = true;
    }

    if (item.str.length > 0) {
      const sameLine =
        current !== null &&
        !breakAfterPrev &&
        !hardBreakPending &&
        Math.abs(y - current.y) <= Math.max(2, current.maxSize * 0.4);

      if (!sameLine) {
        flush();
        current = {
          runs: [],
          y,
          x,
          maxSize: size,
          text: "",
          allBold: false,
          hardStart: hardBreakPending,
        };
        prevEnd = x;
        hardBreakPending = false;
      }

      const line = current!;
      line.maxSize = Math.max(line.maxSize, size);
      const gap = x - prevEnd;
      const needsSpace =
        line.runs.length > 0 &&
        gap > size * 0.18 &&
        !line.runs[line.runs.length - 1]!.text.endsWith(" ") &&
        !item.str.startsWith(" ");
      const text = (needsSpace ? " " : "") + item.str;

      const last = line.runs[line.runs.length - 1];
      if (last && last.bold === style.bold && last.italic === style.italic) {
        last.text += text;
        last.size = Math.max(last.size, size);
      } else {
        line.runs.push({ text, size, bold: style.bold, italic: style.italic });
      }
      prevEnd = x + (item.width ?? 0);
    }

    breakAfterPrev = Boolean(item.hasEOL);
  }
  flush();

  return lines;
}

// --- Line classification / block grouping ------------------------------------

const BULLET_PREFIX = /^\s*([•◦▪▸‣∙·]|-|–|\*)\s+/;

function weightedBodySize(lines: Line[]): number {
  const weights = new Map<number, number>();
  for (const line of lines) {
    for (const run of line.runs) {
      const key = Math.round(run.size * 2) / 2;
      weights.set(key, (weights.get(key) ?? 0) + run.text.trim().length);
    }
  }
  let best = 10;
  let bestWeight = -1;
  for (const [size, weight] of weights) {
    if (weight > bestWeight) {
      best = size;
      bestWeight = weight;
    }
  }
  return best;
}

function headingLevel(line: Line, bodySize: number): 1 | 2 | 3 | null {
  const text = line.text.trim();
  if (!text || text.length > 110) return null;
  if (BULLET_PREFIX.test(text)) return null;
  const ratio = line.maxSize / bodySize;
  if (ratio >= 1.8) return 1;
  if (ratio >= 1.35) return 2;
  if (ratio >= 1.12) return 3;
  // Bold, short, not-a-sentence lines at (or just above) body size read as
  // sub-headings even without a size bump.
  if (line.allBold && ratio >= 1.02 && text.length <= 80 && !/[.,;:]$/.test(text)) {
    return 3;
  }
  return null;
}

/** Drop bare page numbers hugging the top/bottom margins. */
function isPageFurniture(line: Line, pageTop: number, pageBottom: number): boolean {
  const text = line.text.trim();
  if (!/^\d{1,4}$/.test(text)) return false;
  const span = pageTop - pageBottom || 1;
  const fromTop = (pageTop - line.y) / span;
  return fromTop < 0.06 || fromTop > 0.94;
}

function cleanRuns(runs: RichRun[]): RichRun[] {
  const out: RichRun[] = [];
  for (const run of runs) {
    const text = run.text.replace(/\s+/g, " ");
    if (!text) continue;
    const last = out[out.length - 1];
    if (last && Boolean(last.bold) === Boolean(run.bold) && Boolean(last.italic) === Boolean(run.italic)) {
      last.text += text;
    } else {
      out.push({ text, bold: run.bold || undefined, italic: run.italic || undefined });
    }
  }
  if (out.length > 0) {
    out[0]!.text = out[0]!.text.replace(/^\s+/, "");
    out[out.length - 1]!.text = out[out.length - 1]!.text.replace(/\s+$/, "");
  }
  return out.filter((r) => r.text.length > 0);
}

/** Join two line run-lists, handling end-of-line hyphenation. */
function appendLineRuns(target: LineRun[], line: Line): void {
  const last = target[target.length - 1];
  const next = line.runs[0];
  if (last && next) {
    const endsHyphen = /[a-z]-$/.test(last.text.trimEnd());
    const startsLower = /^[a-z]/.test(next.text.trimStart());
    if (endsHyphen && startsLower) {
      last.text = last.text.trimEnd().slice(0, -1);
    } else if (!last.text.endsWith(" ")) {
      last.text += " ";
    }
  }
  for (const run of line.runs) target.push({ ...run });
}

type PositionedBlock = { block: RichTextBlock; top: number };

/**
 * Group classified lines into heading / paragraph / bullet blocks. `top` is the
 * block's first baseline (PDF units, y-up) so images can be interleaved later.
 */
function linesToBlocks(lines: Line[], bodySize: number): PositionedBlock[] {
  const blocks: PositionedBlock[] = [];

  type Pending =
    | { kind: "paragraph"; runs: LineRun[]; top: number; lastY: number; lastSize: number }
    | { kind: "heading"; level: 1 | 2 | 3; runs: LineRun[]; top: number; lastY: number; lastSize: number }
    | { kind: "bullets"; items: LineRun[][]; top: number; lastY: number; lastSize: number };
  let pending: Pending | null = null;

  const flush = () => {
    if (!pending) return;
    if (pending.kind === "bullets") {
      const items = pending.items.map(cleanRuns).filter((i) => i.length > 0);
      if (items.length) blocks.push({ block: { kind: "bullets", items }, top: pending.top });
    } else {
      const runs = cleanRuns(pending.runs);
      if (runs.length) {
        blocks.push({
          block:
            pending.kind === "heading"
              ? { kind: "heading", level: pending.level, runs }
              : { kind: "paragraph", runs },
          top: pending.top,
        });
      }
    }
    pending = null;
  };

  for (const line of lines) {
    const level = headingLevel(line, bodySize);
    const bulletMatch = line.text.match(BULLET_PREFIX);
    const gap = pending ? pending.lastY - line.y : 0;
    const paragraphBreak = pending
      ? line.hardStart || gap > Math.max(pending.lastSize, line.maxSize) * 1.7 || gap < 0
      : true;

    if (bulletMatch) {
      const stripped: Line = { ...line, runs: stripBulletPrefix(line.runs) };
      if (pending?.kind === "bullets" && !paragraphBreak) {
        pending.items.push(stripped.runs.map((r) => ({ ...r })));
      } else {
        flush();
        pending = {
          kind: "bullets",
          items: [stripped.runs.map((r) => ({ ...r }))],
          top: line.y,
          lastY: line.y,
          lastSize: line.maxSize,
        };
      }
    } else if (level) {
      if (
        pending?.kind === "heading" &&
        pending.level === level &&
        !paragraphBreak
      ) {
        appendLineRuns(pending.runs, line);
      } else {
        flush();
        pending = {
          kind: "heading",
          level,
          runs: line.runs.map((r) => ({ ...r })),
          top: line.y,
          lastY: line.y,
          lastSize: line.maxSize,
        };
      }
    } else {
      if (pending?.kind === "paragraph" && !paragraphBreak) {
        appendLineRuns(pending.runs, line);
      } else {
        flush();
        pending = {
          kind: "paragraph",
          runs: line.runs.map((r) => ({ ...r })),
          top: line.y,
          lastY: line.y,
          lastSize: line.maxSize,
        };
      }
    }
    if (pending) {
      pending.lastY = line.y;
      pending.lastSize = line.maxSize;
    }
  }
  flush();

  return blocks;
}

function stripBulletPrefix(runs: LineRun[]): LineRun[] {
  const out = runs.map((r) => ({ ...r }));
  for (const run of out) {
    const before = run.text;
    run.text = run.text.replace(BULLET_PREFIX, "");
    if (run.text !== before) break;
    if (before.trim()) break;
  }
  return out.filter((r) => r.text.trim().length > 0 || out.length === 1);
}

// --- Embedded images ----------------------------------------------------------

type RawImageRef =
  | { name: string; ctm: Matrix }
  | { inline: unknown; ctm: Matrix };

/** Walk the operator list tracking the CTM to find where images are painted. */
async function collectImagePaintOps(page: PdfPage, ops: Record<string, number>): Promise<RawImageRef[]> {
  const opList = await page.getOperatorList();
  const refs: RawImageRef[] = [];
  let ctm: Matrix = [...IDENTITY];
  const stack: Matrix[] = [];

  for (let i = 0; i < opList.fnArray.length; i += 1) {
    const fn = opList.fnArray[i];
    const args = opList.argsArray[i];
    switch (fn) {
      case ops.save:
        stack.push([...ctm]);
        break;
      case ops.restore:
        ctm = stack.pop() ?? [...IDENTITY];
        break;
      case ops.transform:
        ctm = concat(ctm, args as unknown as Matrix);
        break;
      case ops.paintImageXObject:
        if (typeof (args as unknown[])[0] === "string") {
          refs.push({ name: (args as unknown[])[0] as string, ctm: [...ctm] });
        }
        break;
      case ops.paintInlineImageXObject:
        refs.push({ inline: (args as unknown[])[0], ctm: [...ctm] });
        break;
      default:
        break;
    }
  }
  return refs;
}

function regionFromCtm(
  ctm: Matrix,
  pageTop: number,
  pageLeft: number,
): Omit<PdfImageRegion, "pixelWidth" | "pixelHeight"> {
  // Images paint into the unit square transformed by the CTM.
  const corners = [
    applyMatrix(ctm, 0, 0),
    applyMatrix(ctm, 1, 0),
    applyMatrix(ctm, 0, 1),
    applyMatrix(ctm, 1, 1),
  ];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    x: minX - pageLeft,
    y: pageTop - maxY, // convert y-up to distance from page top
    width: maxX - minX,
    height: maxY - minY,
  };
}

type DecodedPdfImage = { region: PdfImageRegion; png: Buffer };

type PdfImageObject = {
  width?: number;
  height?: number;
  kind?: number;
  data?: Uint8Array | Uint8ClampedArray;
};

/** pdfjs ImageKind values. */
const KIND_GRAYSCALE_1BPP = 1;
const KIND_RGB_24BPP = 2;
const KIND_RGBA_32BPP = 3;

async function decodeToPng(obj: PdfImageObject): Promise<{ png: Buffer; width: number; height: number } | null> {
  const width = obj.width ?? 0;
  const height = obj.height ?? 0;
  const data = obj.data;
  if (!width || !height || !data) return null;
  if (width * height > MAX_IMAGE_AREA) return null;

  const kind =
    obj.kind ??
    (data.length >= width * height * 4
      ? KIND_RGBA_32BPP
      : data.length >= width * height * 3
        ? KIND_RGB_24BPP
        : data.length >= Math.ceil(width / 8) * height
          ? KIND_GRAYSCALE_1BPP
          : 0);
  const rgba = new Uint8ClampedArray(width * height * 4);
  if (kind === KIND_RGBA_32BPP && data.length >= width * height * 4) {
    rgba.set(data.subarray(0, width * height * 4));
  } else if (kind === KIND_RGB_24BPP && data.length >= width * height * 3) {
    for (let p = 0, s = 0; p < width * height; p += 1, s += 3) {
      const d = p * 4;
      rgba[d] = data[s]!;
      rgba[d + 1] = data[s + 1]!;
      rgba[d + 2] = data[s + 2]!;
      rgba[d + 3] = 255;
    }
  } else if (kind === KIND_GRAYSCALE_1BPP) {
    const rowBytes = Math.ceil(width / 8);
    if (data.length < rowBytes * height) return null;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const bit = (data[y * rowBytes + (x >> 3)]! >> (7 - (x & 7))) & 1;
        const v = bit ? 255 : 0;
        const d = (y * width + x) * 4;
        rgba[d] = v;
        rgba[d + 1] = v;
        rgba[d + 2] = v;
        rgba[d + 3] = 255;
      }
    }
  } else {
    return null;
  }

  const { createCanvas } = await loadCanvasRuntime();
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  const imageData = ctx.createImageData(width, height);
  imageData.data.set(rgba);
  ctx.putImageData(imageData, 0, 0);
  return { png: canvas.toBuffer("image/png"), width, height };
}

function pageSize(page: PdfPage): {
  width: number;
  height: number;
  top: number;
  left: number;
} {
  const [x0, y0, x1, y1] = page.view;
  return {
    width: (x1 ?? 612) - (x0 ?? 0),
    height: (y1 ?? 792) - (y0 ?? 0),
    top: y1 ?? 792,
    left: x0 ?? 0,
  };
}

function isBackgroundRegion(
  region: { width: number; height: number },
  page: { width: number; height: number },
): boolean {
  return (region.width * region.height) / (page.width * page.height) >= MAX_PAGE_COVERAGE;
}

/**
 * Regions of embedded raster images on a page (positions only — no pixel
 * decoding). Used by occlusion extraction to crop page renders to figures.
 */
export async function collectPdfImageRegions(
  page: unknown,
  ops: Record<string, number>,
): Promise<PdfImageRegion[]> {
  const p = page as PdfPage;
  const size = pageSize(p);
  const refs = await collectImagePaintOps(p, ops);
  const regions: PdfImageRegion[] = [];
  for (const ref of refs) {
    const base = regionFromCtm(ref.ctm, size.top, size.left);
    if (base.width < 8 || base.height < 8) continue;
    let pixelWidth = 0;
    let pixelHeight = 0;
    if ("name" in ref) {
      const obj = (await getPdfObject(p, ref.name)) as PdfImageObject | null;
      pixelWidth = obj?.width ?? 0;
      pixelHeight = obj?.height ?? 0;
    } else {
      const obj = ref.inline as PdfImageObject | null;
      pixelWidth = obj?.width ?? 0;
      pixelHeight = obj?.height ?? 0;
    }
    regions.push({ ...base, pixelWidth, pixelHeight });
  }
  return regions;
}

/** Decode a page's useful embedded images (figures, not icons/backgrounds). */
async function collectPageImages(page: PdfPage, ops: Record<string, number>): Promise<DecodedPdfImage[]> {
  const size = pageSize(page);
  const refs = await collectImagePaintOps(page, ops);
  const out: DecodedPdfImage[] = [];

  for (const ref of refs) {
    try {
      const obj = ("name" in ref ? await getPdfObject(page, ref.name) : ref.inline) as
        | PdfImageObject
        | null;
      if (!obj) continue;

      const base = regionFromCtm(ref.ctm, size.top, size.left);
      if (base.width < MIN_DISPLAY_PT || base.height < MIN_DISPLAY_PT) continue;
      if (isBackgroundRegion(base, size)) continue;

      const pixelWidth = obj.width ?? 0;
      const pixelHeight = obj.height ?? 0;
      if (Math.max(pixelWidth, pixelHeight) < MIN_IMAGE_PIXELS) continue;

      const decoded = await decodeToPng(obj);
      if (!decoded) continue;

      out.push({
        region: { ...base, pixelWidth, pixelHeight },
        png: decoded.png,
      });
    } catch (err) {
      console.warn("[pdf-rich] image decode failed:", err);
    }
  }
  return out;
}

// --- Page assembly -------------------------------------------------------------

function interleaveImages(
  textBlocks: PositionedBlock[],
  images: DecodedPdfImage[],
  pageTop: number,
  seenImageKeys: Set<string>,
): RichBlock[] {
  const imageBlocks = images
    .map((img) => {
      const centerFromTop = img.region.y + img.region.height / 2;
      return {
        block: {
          kind: "image" as const,
          bytes: img.png,
          mime: "image/png" as const,
          width: img.region.pixelWidth,
          height: img.region.pixelHeight,
        },
        // Convert "distance from top" back to y-up baseline space for sorting.
        top: pageTop - centerFromTop,
        key: `${img.region.pixelWidth}x${img.region.pixelHeight}:${img.png.length}`,
      };
    })
    // De-dupe repeated assets (logos/watermarks) across the document.
    .filter((entry) => {
      if (seenImageKeys.has(entry.key)) return false;
      seenImageKeys.add(entry.key);
      return true;
    });

  const merged = [
    ...textBlocks.map((b) => ({ block: b.block as RichBlock, top: b.top })),
    ...imageBlocks.map((b) => ({ block: b.block as RichBlock, top: b.top })),
  ];
  // PDF y-up: higher y = closer to the top of the page.
  merged.sort((a, b) => b.top - a.top);
  return merged.map((entry) => entry.block);
}

export type ExtractPdfRichOptions = {
  /** Decode and include embedded images (slower). Defaults to true. */
  includeImages?: boolean;
  /** Stop decoding images after this many (keeps seeding fast). Default 60. */
  maxImages?: number;
};

export async function extractPdfRich(
  buffer: Buffer,
  options: ExtractPdfRichOptions = {},
): Promise<RichPdfResult> {
  const includeImages = options.includeImages !== false;
  const maxImages = options.maxImages ?? 60;
  const pdfjs = await loadPdfjs();
  const ops = pdfjs.OPS as unknown as Record<string, number>;

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    useSystemFonts: true,
    isOffscreenCanvasSupported: false,
  });

  const pages: RichPdfPage[] = [];
  const seenImageKeys = new Set<string>();
  let totalImages = 0;

  try {
    const doc = await loadingTask.promise;
    const pageCount = doc.numPages;
    const limit = Math.min(pageCount, MAX_SOURCE_DOCUMENT_PAGES);

    // Body size is estimated document-wide for stable heading detection.
    const pageLines: Line[][] = [];
    const pdfPages: PdfPage[] = [];
    for (let n = 1; n <= limit; n += 1) {
      const page = (await doc.getPage(n)) as unknown as PdfPage;
      pdfPages.push(page);
      try {
        // Building the operator list loads the page's fonts into the object
        // store — required for bold/italic detection below. It's cached, so the
        // later image pass reuses it for free.
        try {
          await page.getOperatorList();
        } catch {
          // Font styles degrade to regular; text extraction still works.
        }
        const textContent = await page.getTextContent();
        const items = textContent.items.filter(isTextItem);
        const fontStyles = await resolveFontStyles(page, items);
        pageLines.push(buildLines(items, fontStyles));
      } catch (err) {
        console.warn(`[pdf-rich] text extraction failed on page ${n}:`, err);
        pageLines.push([]);
      }
    }

    const bodySize = weightedBodySize(pageLines.flat());

    for (let i = 0; i < pdfPages.length; i += 1) {
      const page = pdfPages[i]!;
      const pageNumber = i + 1;
      const size = pageSize(page);
      const lines = pageLines[i]!.filter(
        (line) => !isPageFurniture(line, size.top, size.top - size.height),
      );
      const textBlocks = linesToBlocks(lines, bodySize);

      let images: DecodedPdfImage[] = [];
      if (includeImages && totalImages < maxImages) {
        try {
          images = (await collectPageImages(page, ops)).slice(0, maxImages - totalImages);
          totalImages += images.length;
        } catch (err) {
          console.warn(`[pdf-rich] image extraction failed on page ${pageNumber}:`, err);
        }
      }

      const blocks = interleaveImages(textBlocks, images, size.top, seenImageKeys);
      if (blocks.length > 0) {
        pages.push({ pageNumber, blocks });
      }
      page.cleanup?.();
    }

    return { pages, pageCount };
  } finally {
    await loadingTask.destroy();
  }
}
