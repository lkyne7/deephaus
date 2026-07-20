import "server-only";
import { imageSize } from "image-size";
import { MAX_SOURCE_DOCUMENT_PAGES, type SourceType } from "@deephaus/shared";
import { collectPdfImageRegions, type PdfImageRegion } from "@/lib/pdf/extract-rich";
import { loadPdfjsRuntime } from "@/lib/pdf/runtime";

/** A raster image pulled out of a document, ready for occlusion detection. */
export type ExtractedImage = {
  bytes: Buffer;
  mime: string;
  width: number;
  height: number;
  /** Human-readable source location, used for card tags (e.g. "Page 4"). */
  ref: string;
};

export type ExtractSourceImagesOptions = {
  /** When set, only extract/render these page or slide numbers (1-based). */
  pageNumbers?: number[];
};

/** Skip icons, bullets, rules and decorative strips — keep real diagrams. */
const MIN_DIMENSION = 200;
const MIN_AREA = 240 * 240;
const MAX_ASPECT_RATIO = 5;
/** Guard against pathologically large embedded images (memory + encode cost). */
const MAX_AREA = 12_000_000;
/** Target width for page/slide renders used in occlusion OCR. */
const STUDY_RENDER_MAX_WIDTH = 1200;

const EMU_PER_INCH = 914400;
const DEFAULT_SLIDE_WIDTH_EMU = 9144000;
const DEFAULT_SLIDE_HEIGHT_EMU = 6858000;

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
    default:
      return "application/octet-stream";
  }
}

function isUsefulImage(width: number, height: number): boolean {
  if (!width || !height) return false;
  if (width < MIN_DIMENSION || height < MIN_DIMENSION) return false;
  const area = width * height;
  if (area < MIN_AREA || area > MAX_AREA) return false;
  const aspect = width / height;
  if (aspect > MAX_ASPECT_RATIO || aspect < 1 / MAX_ASPECT_RATIO) return false;
  return true;
}

/**
 * De-dupe repeated assets (logos, page headers/footers, slide masters) that
 * otherwise show up on many pages.
 */
function dedupeAndCap(images: ExtractedImage[]): ExtractedImage[] {
  const seen = new Set<string>();
  const out: ExtractedImage[] = [];
  for (const img of images) {
    if (!isUsefulImage(img.width, img.height)) continue;
    const key = `${img.ref}:${img.width}x${img.height}:${img.bytes.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(img);
  }
  return out;
}

function measure(bytes: Buffer): { width: number; height: number } | null {
  try {
    const dims = imageSize(bytes);
    if (!dims.width || !dims.height) return null;
    return { width: dims.width, height: dims.height };
  } catch {
    return null;
  }
}

function slideNumber(path: string): number {
  const match = path.match(/slide(\d+)\.xml$/);
  return match ? Number(match[1]) : 0;
}

function normalizePageNumbers(
  pageNumbers: number[] | undefined,
  maxPage: number,
): number[] {
  if (pageNumbers?.length) {
    return [...new Set(pageNumbers)]
      .filter((n) => n >= 1 && n <= Math.min(maxPage, MAX_SOURCE_DOCUMENT_PAGES))
      .sort((a, b) => a - b);
  }
  const cappedMax = Math.min(maxPage, MAX_SOURCE_DOCUMENT_PAGES);
  return Array.from({ length: cappedMax }, (_, i) => i + 1);
}

/** Pad figure crops so labels hugging the figure edge are included (PDF units).
 * Kept tight — generous pads pull in captions/body text, which OCR then turns
 * into junk occlusion regions. Vertical padding is minimal because captions
 * ("Figure 1: …") sit directly above/below figures. */
const FIGURE_PAD_FRACTION = 0.05;
const FIGURE_PAD_MIN_PT = 10;
const FIGURE_PAD_VERTICAL_PT = 4;
/** Cap crops per page (largest first) so busy pages don't flood the scan. */
const MAX_CROPS_PER_PAGE = 4;
/** Pages with more text than this are prose, not diagrams — skip the full-page
 * fallback for them (it only exists for vector-drawn/label-only pages). */
const FALLBACK_MAX_TEXT_CHARS = 450;
/** Displayed figure size below this is an icon, not a diagram (PDF units). */
const FIGURE_MIN_DISPLAY_PT = 60;
/** Regions covering most of the page are backgrounds/scans — use the full page. */
const FIGURE_MAX_PAGE_COVERAGE = 0.8;

type CropRect = { x: number; y: number; width: number; height: number };

function padRegion(region: PdfImageRegion, pageWidth: number, pageHeight: number): CropRect {
  const padX = Math.max(
    FIGURE_PAD_MIN_PT,
    Math.max(region.width, region.height) * FIGURE_PAD_FRACTION,
  );
  const x = Math.max(0, region.x - padX);
  const y = Math.max(0, region.y - FIGURE_PAD_VERTICAL_PT);
  return {
    x,
    y,
    width: Math.min(pageWidth, region.x + region.width + padX) - x,
    height: Math.min(pageHeight, region.y + region.height + FIGURE_PAD_VERTICAL_PT) - y,
  };
}

function rectsOverlap(a: CropRect, b: CropRect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

function unionRects(a: CropRect, b: CropRect): CropRect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

/** Merge overlapping crops so adjacent sub-images become one figure region. */
function mergeCropRects(rects: CropRect[]): CropRect[] {
  const out = [...rects];
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < out.length; i += 1) {
      for (let j = i + 1; j < out.length; j += 1) {
        if (rectsOverlap(out[i]!, out[j]!)) {
          out[i] = unionRects(out[i]!, out[j]!);
          out.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  return out;
}

/**
 * Figure crop regions for a page: embedded raster images that are big enough to
 * be diagrams, padded to catch labels drawn next to them, merged when adjacent.
 * Empty when the page has no usable figures (caller falls back to full page).
 */
function figureCropsForPage(
  regions: PdfImageRegion[],
  pageWidth: number,
  pageHeight: number,
): CropRect[] {
  const pageArea = pageWidth * pageHeight;
  const candidates = regions.filter((region) => {
    if (region.width < FIGURE_MIN_DISPLAY_PT || region.height < FIGURE_MIN_DISPLAY_PT) {
      return false;
    }
    // Whole-page background/scan: treat as no distinct figure regions.
    if ((region.width * region.height) / pageArea >= FIGURE_MAX_PAGE_COVERAGE) return false;
    return true;
  });
  if (candidates.length === 0) return [];
  return mergeCropRects(
    candidates.map((region) => padRegion(region, pageWidth, pageHeight)),
  );
}

/** Approximate character count of a page's text layer. */
async function pageTextChars(page: {
  getTextContent(): Promise<{ items: unknown[] }>;
}): Promise<number> {
  try {
    const tc = await page.getTextContent();
    let chars = 0;
    for (const item of tc.items) {
      const str = (item as { str?: string }).str;
      if (typeof str === "string") chars += str.trim().length;
    }
    return chars;
  } catch {
    return 0;
  }
}

/**
 * Render PDF pages for label OCR. When a page carries distinct embedded figures,
 * each figure is cropped out (lightly padded, so labels hugging it are kept) and
 * becomes its own occlusion candidate. Pages without detectable figure regions
 * fall back to a full-page render only when they carry little text — that covers
 * scans and vector-drawn diagrams while keeping prose pages from turning into
 * junk occlusion cards.
 */
async function extractPdfPageRenders(
  buffer: Buffer,
  pageNumbers?: number[],
): Promise<ExtractedImage[]> {
  const { canvas: { createCanvas }, pdfjs } = await loadPdfjsRuntime();
  const ops = pdfjs.OPS as unknown as Record<string, number>;

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    useSystemFonts: true,
    isOffscreenCanvasSupported: false,
  });

  const out: ExtractedImage[] = [];
  try {
    const doc = await loadingTask.promise;
    const pagesToRender = normalizePageNumbers(pageNumbers, doc.numPages);

    for (const pageNum of pagesToRender) {
      let page;
      try {
        page = await doc.getPage(pageNum);
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = Math.min(2, STUDY_RENDER_MAX_WIDTH / baseViewport.width);
        const viewport = page.getViewport({ scale });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({
          canvas: canvas as unknown as HTMLCanvasElement,
          canvasContext: ctx as unknown as CanvasRenderingContext2D,
          viewport,
        }).promise;

        let crops: CropRect[] = [];
        try {
          const regions = await collectPdfImageRegions(page, ops);
          crops = figureCropsForPage(regions, baseViewport.width, baseViewport.height)
            .sort((a, b) => b.width * b.height - a.width * a.height)
            .slice(0, MAX_CROPS_PER_PAGE);
        } catch (err) {
          console.warn(`[extract-images] figure detection failed on page ${pageNum}:`, err);
        }

        if (crops.length > 0) {
          for (const crop of crops) {
            const cropWidth = Math.max(1, Math.round(crop.width * scale));
            const cropHeight = Math.max(1, Math.round(crop.height * scale));
            const cropCanvas = createCanvas(cropWidth, cropHeight);
            const cropCtx = cropCanvas.getContext("2d");
            cropCtx.drawImage(
              canvas,
              crop.x * scale,
              crop.y * scale,
              cropWidth,
              cropHeight,
              0,
              0,
              cropWidth,
              cropHeight,
            );
            out.push({
              bytes: cropCanvas.toBuffer("image/png"),
              mime: "image/png",
              width: cropWidth,
              height: cropHeight,
              ref: `Page ${pageNum}`,
            });
          }
        } else if ((await pageTextChars(page)) <= FALLBACK_MAX_TEXT_CHARS) {
          // Little text + no raster figures: likely a scan or a vector-drawn
          // diagram — OCR the whole page.
          out.push({
            bytes: canvas.toBuffer("image/png"),
            mime: "image/png",
            width: canvas.width,
            height: canvas.height,
            ref: `Page ${pageNum}`,
          });
        }
      } catch {
        // Skip a page that fails to render rather than aborting the whole doc.
      } finally {
        page?.cleanup?.();
      }
    }
  } finally {
    await loadingTask.destroy();
  }

  return out;
}

type PptxRels = Map<string, string>;

async function loadPptxRels(zip: import("jszip"), relsPath: string): Promise<PptxRels> {
  const relsFile = zip.file(relsPath);
  const out: PptxRels = new Map();
  if (!relsFile) return out;
  const relsXml = await relsFile.async("text");
  for (const match of relsXml.matchAll(
    /Id="([^"]+)"[^>]*Target="([^"]+)"/g,
  )) {
    const id = match[1]!;
    const target = match[2]!;
    if (target.includes("../media/")) {
      out.set(id, target.replace("../", "ppt/"));
    }
  }
  return out;
}

/** Composite each slide (images + text labels) onto a canvas for OCR. */
async function extractPptxSlideComposites(
  buffer: Buffer,
  slideNumbers?: number[],
): Promise<ExtractedImage[]> {
  const JSZip = (await import("jszip")).default;
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const zip = await JSZip.loadAsync(buffer);
  const out: ExtractedImage[] = [];

  let slideWidthEmu = DEFAULT_SLIDE_WIDTH_EMU;
  let slideHeightEmu = DEFAULT_SLIDE_HEIGHT_EMU;
  const presXml = await zip.file("ppt/presentation.xml")?.async("text");
  if (presXml) {
    const sizeMatch = presXml.match(/<p:sldSz[^>]*\bw="(\d+)"[^>]*\bh="(\d+)"/);
    if (sizeMatch) {
      slideWidthEmu = Number(sizeMatch[1]);
      slideHeightEmu = Number(sizeMatch[2]);
    }
  }

  const slidePaths = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => slideNumber(a) - slideNumber(b));

  const slideLimit = Math.min(slidePaths.length, MAX_SOURCE_DOCUMENT_PAGES);
  for (let i = 0; i < slideLimit; i += 1) {
    const slideNum = i + 1;
    if (slideNumbers?.length && !slideNumbers.includes(slideNum)) continue;

    const slidePath = slidePaths[i]!;
    const slideXml = await zip.file(slidePath)!.async("text");
    const relsPath = slidePath
      .replace("ppt/slides/", "ppt/slides/_rels/")
      .replace(".xml", ".xml.rels");
    const rels = await loadPptxRels(zip, relsPath);

    const canvasWidth = STUDY_RENDER_MAX_WIDTH;
    const canvasHeight = Math.max(
      1,
      Math.round(canvasWidth * (slideHeightEmu / slideWidthEmu)),
    );
    const scaleX = canvasWidth / slideWidthEmu;
    const scaleY = canvasHeight / slideHeightEmu;

    const canvas = createCanvas(canvasWidth, canvasHeight);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // Draw embedded images at their slide positions.
    for (const picBlock of slideXml.split("<p:pic>").slice(1)) {
      const embedMatch = picBlock.match(/r:embed="([^"]+)"/);
      if (!embedMatch) continue;
      const mediaPath = rels.get(embedMatch[1]!);
      if (!mediaPath) continue;
      const mediaFile = zip.file(mediaPath);
      if (!mediaFile) continue;

      const bytes = Buffer.from(await mediaFile.async("arraybuffer"));
      try {
        const img = await loadImage(bytes);
        const offMatch = picBlock.match(/<a:off x="(\d+)" y="(\d+)"/);
        const extMatch = picBlock.match(/<a:ext cx="(\d+)" cy="(\d+)"/);
        const x = offMatch ? Number(offMatch[1]) * scaleX : 0;
        const y = offMatch ? Number(offMatch[2]) * scaleY : 0;
        const w = extMatch ? Number(extMatch[1]) * scaleX : img.width;
        const h = extMatch ? Number(extMatch[2]) * scaleY : img.height;
        ctx.drawImage(img, x, y, w, h);
      } catch {
        // Skip unreadable media on this slide.
      }
    }

    // Overlay text labels from shapes (vector text on slides).
    for (const spBlock of slideXml.split("<p:sp>").slice(1)) {
      const texts = [...spBlock.matchAll(/<a:t>([^<]*)<\/a:t>/g)]
        .map((m) => m[1] ?? "")
        .join("")
        .trim();
      if (!texts) continue;
      const offMatch = spBlock.match(/<a:off x="(\d+)" y="(\d+)"/);
      if (!offMatch) continue;
      const x = Number(offMatch[1]) * scaleX;
      const y = Number(offMatch[2]) * scaleY;
      const fontSize = Math.max(10, Math.min(28, 14 * scaleX * EMU_PER_INCH));
      ctx.fillStyle = "#111111";
      ctx.font = `600 ${fontSize}px sans-serif`;
      ctx.fillText(texts, x, y + fontSize);
    }

    const png = canvas.toBuffer("image/png");
    out.push({
      bytes: png,
      mime: "image/png",
      width: canvasWidth,
      height: canvasHeight,
      ref: `Slide ${slideNum}`,
    });
  }

  return out;
}

/** Extract embedded images from Word documents (`word/media/`). */
async function extractDocxImages(buffer: Buffer): Promise<ExtractedImage[]> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);
  const out: ExtractedImage[] = [];
  let figureIndex = 0;

  const entries = Object.values(zip.files)
    .filter((f) => !f.dir && /^word\/media\/[^/]+\.(png|jpe?g|gif|webp)$/i.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  for (const entry of entries) {
    const bytes = Buffer.from(await entry.async("arraybuffer"));
    const dims = measure(bytes);
    if (!dims) continue;
    figureIndex += 1;
    out.push({
      bytes,
      mime: mimeFromName(entry.name),
      width: dims.width,
      height: dims.height,
      ref: `Figure ${figureIndex}`,
    });
  }

  return out;
}

/**
 * Extract diagram-like images from a document source. Returns an empty array
 * for unsupported types or when nothing useful is found — callers should treat
 * this as best-effort and never fail generation because of it.
 *
 * PDF/PPTX: renders full pages/slides (text + graphics) so OCR can see labels.
 * DOCX: embedded media images from `word/media/`.
 */
export async function extractSourceImages(
  buffer: Buffer,
  sourceType: SourceType,
  options?: ExtractSourceImagesOptions,
): Promise<ExtractedImage[]> {
  try {
    if (sourceType === "pdf") {
      return dedupeAndCap(await extractPdfPageRenders(buffer, options?.pageNumbers));
    }
    if (sourceType === "pptx") {
      return dedupeAndCap(
        await extractPptxSlideComposites(buffer, options?.pageNumbers),
      );
    }
    if (sourceType === "docx") {
      return dedupeAndCap(await extractDocxImages(buffer));
    }
    return [];
  } catch (err) {
    console.warn("[extract-images] extraction failed:", err);
    return [];
  }
}
