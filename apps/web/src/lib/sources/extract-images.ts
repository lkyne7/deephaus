import "server-only";
import { imageSize } from "image-size";
import type { SourceType } from "@deephaus/shared";

/** A raster image pulled out of a document, ready for occlusion detection. */
export type ExtractedImage = {
  bytes: Buffer;
  mime: string;
  width: number;
  height: number;
  /** Human-readable source location, used for card tags (e.g. "Page 4"). */
  ref: string;
};

/** Skip icons, bullets, rules and decorative strips — keep real diagrams. */
const MIN_DIMENSION = 200;
const MIN_AREA = 240 * 240;
const MAX_ASPECT_RATIO = 5;
/** Guard against pathologically large embedded images (memory + encode cost). */
const MAX_AREA = 12_000_000;
/** Cap how many candidate images we hand off for (slow) OCR detection. */
const MAX_IMAGES = 12;
/** Bound the work for very long documents. */
const MAX_PDF_PAGES = 60;

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
 * otherwise show up on many pages, and enforce the global candidate cap.
 */
function dedupeAndCap(images: ExtractedImage[]): ExtractedImage[] {
  const seen = new Set<string>();
  const out: ExtractedImage[] = [];
  for (const img of images) {
    if (!isUsefulImage(img.width, img.height)) continue;
    const key = `${img.width}x${img.height}:${img.bytes.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(img);
    if (out.length >= MAX_IMAGES) break;
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

/** PowerPoint stores raster media verbatim under ppt/media — just read it back. */
async function extractPptxImages(buffer: Buffer): Promise<ExtractedImage[]> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);
  const out: ExtractedImage[] = [];

  const entries = Object.values(zip.files)
    .filter((f) => !f.dir && /^ppt\/media\/[^/]+\.(png|jpe?g|gif|webp)$/i.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  for (const entry of entries) {
    const bytes = Buffer.from(await entry.async("arraybuffer"));
    const dims = measure(bytes);
    if (!dims) continue;
    out.push({
      bytes,
      mime: mimeFromName(entry.name),
      width: dims.width,
      height: dims.height,
      ref: "Slides",
    });
  }
  return out;
}

// Minimal shape of the pdf.js image objects we read (avoids depending on exact
// type exports, which vary across pdf.js builds).
type PdfImageObject = {
  width?: number;
  height?: number;
  kind?: number;
  data?: Uint8Array | Uint8ClampedArray | null;
};

// pdf.js ImageKind values: 1 = GRAYSCALE_1BPP, 2 = RGB_24BPP, 3 = RGBA_32BPP.
const RGB_24BPP = 2;
const RGBA_32BPP = 3;

function imageObjectToPng(
  img: PdfImageObject,
  PNG: typeof import("pngjs").PNG,
): Buffer | null {
  const { width, height, kind, data } = img;
  if (!width || !height || !data) return null;
  if (!isUsefulImage(width, height)) return null;

  const src = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const pixels = width * height;
  const rgba = Buffer.alloc(pixels * 4);

  if (kind === RGBA_32BPP) {
    if (src.length < pixels * 4) return null;
    src.copy(rgba, 0, 0, pixels * 4);
  } else if (kind === RGB_24BPP) {
    if (src.length < pixels * 3) return null;
    for (let i = 0; i < pixels; i += 1) {
      rgba[i * 4] = src[i * 3];
      rgba[i * 4 + 1] = src[i * 3 + 1];
      rgba[i * 4 + 2] = src[i * 3 + 2];
      rgba[i * 4 + 3] = 255;
    }
  } else {
    // Grayscale 1bpp and other packed formats are usually line-art / masks —
    // not worth occluding, and risky to decode. Skip them.
    return null;
  }

  const png = new PNG({ width, height });
  rgba.copy(png.data);
  return PNG.sync.write(png);
}

/** Resolve a pdf.js image XObject by name, tolerating async object stores. */
function resolveImage(
  objs: { has?: (name: string) => boolean; get: (name: string, cb?: (v: unknown) => void) => unknown },
  name: string,
): Promise<PdfImageObject | null> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value: unknown) => {
      if (settled) return;
      settled = true;
      resolve((value as PdfImageObject) ?? null);
    };
    try {
      if (objs.has?.(name)) {
        done(objs.get(name));
        return;
      }
      objs.get(name, done);
      // Don't hang the whole job on a single stubborn object.
      setTimeout(() => done(null), 4000);
    } catch {
      resolve(null);
    }
  });
}

/** Pull embedded raster images out of each PDF page via pdf.js operator lists. */
async function extractPdfImages(buffer: Buffer): Promise<ExtractedImage[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { PNG } = await import("pngjs");

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    useSystemFonts: false,
  });

  const out: ExtractedImage[] = [];
  let doc: Awaited<typeof loadingTask.promise> | null = null;
  try {
    doc = await loadingTask.promise;
    const pageCount = Math.min(doc.numPages, MAX_PDF_PAGES);

    for (let pageNum = 1; pageNum <= pageCount; pageNum += 1) {
      let page;
      try {
        page = await doc.getPage(pageNum);
        const ops = await page.getOperatorList();
        const seenOnPage = new Set<string>();

        for (let i = 0; i < ops.fnArray.length; i += 1) {
          const fn = ops.fnArray[i];
          if (
            fn !== pdfjs.OPS.paintImageXObject &&
            fn !== pdfjs.OPS.paintImageXObjectRepeat
          ) {
            continue;
          }
          const name = ops.argsArray[i]?.[0];
          if (typeof name !== "string" || seenOnPage.has(name)) continue;
          seenOnPage.add(name);

          // Image XObjects live on page.objs; some shared ones on commonObjs.
          const store =
            (page.objs as { has?: (n: string) => boolean })?.has?.(name)
              ? page.objs
              : page.commonObjs;
          const img = await resolveImage(store as never, name);
          if (!img) continue;
          const png = imageObjectToPng(img, PNG);
          if (!png || !img.width || !img.height) continue;
          out.push({
            bytes: png,
            mime: "image/png",
            width: img.width,
            height: img.height,
            ref: `Page ${pageNum}`,
          });
        }
      } catch {
        // Skip a page that fails to parse rather than aborting the whole doc.
      } finally {
        page?.cleanup?.();
      }

      // Gather a little extra so de-dupe still leaves us a full set.
      if (out.length >= MAX_IMAGES * 3) break;
    }
  } finally {
    // Destroying the loading task tears down the worker + document.
    await loadingTask.destroy();
  }

  return out;
}

/**
 * Extract diagram-like images from a document source. Returns an empty array
 * for unsupported types or when nothing useful is found — callers should treat
 * this as best-effort and never fail generation because of it.
 */
export async function extractSourceImages(
  buffer: Buffer,
  sourceType: SourceType,
): Promise<ExtractedImage[]> {
  try {
    if (sourceType === "pdf") {
      return dedupeAndCap(await extractPdfImages(buffer));
    }
    if (sourceType === "pptx") {
      return dedupeAndCap(await extractPptxImages(buffer));
    }
    return [];
  } catch (err) {
    console.warn("[extract-images] extraction failed:", err);
    return [];
  }
}
