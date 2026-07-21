import "server-only";
import type { SourceType } from "@deephaus/shared";
import { loadCanvasRuntime, loadPdfjsRuntime } from "@/lib/pdf/runtime";
import type { SourceChunkPreview } from "@/lib/sources/chunks";
import { collectSegmentPageNumbers, enrichChunkPreviews } from "@/lib/sources/chunks";

const THUMB_MAX_WIDTH = 168;
const MAX_THUMBNAIL_PAGES = 80;

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

function toDataUrl(bytes: Buffer, mime: string): string {
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

async function createPlaceholderDataUrl(label: string): Promise<string> {
  const { createCanvas } = await loadCanvasRuntime();
  const width = 168;
  const height = 120;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f4f4f5";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#e4e4e7";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
  ctx.fillStyle = "#71717a";
  ctx.font = "600 14px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, width / 2, height / 2);
  return toDataUrl(canvas.toBuffer("image/png"), "image/png");
}

async function renderPdfPageThumbnails(
  buffer: Buffer,
  pageNumbers: number[],
  maxWidth = THUMB_MAX_WIDTH,
): Promise<Map<number, string>> {
  const {
    canvas: { createCanvas },
    pdfjs,
    documentOptions,
  } = await loadPdfjsRuntime();
  const out = new Map<number, string>();

  const loadingTask = pdfjs.getDocument({
    ...documentOptions,
    data: new Uint8Array(buffer),
    disableFontFace: true,
    useSystemFonts: true,
  });

  try {
    const doc = await loadingTask.promise;
    const unique = [...new Set(pageNumbers)]
      .filter((n) => n >= 1 && n <= doc.numPages)
      .sort((a, b) => a - b)
      .slice(0, MAX_THUMBNAIL_PAGES);

    for (const pageNum of unique) {
      let page;
      try {
        page = await doc.getPage(pageNum);
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = Math.min(2, maxWidth / baseViewport.width);
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
        out.set(pageNum, toDataUrl(canvas.toBuffer("image/png"), "image/png"));
      } catch {
        out.set(pageNum, await createPlaceholderDataUrl(`Page ${pageNum}`));
      } finally {
        page?.cleanup?.();
      }
    }
  } finally {
    await loadingTask.destroy();
  }

  return out;
}

function slideNumber(path: string): number {
  const match = path.match(/slide(\d+)\.xml$/);
  return match ? Number(match[1]) : 0;
}

async function extractPptxSlideThumbnails(buffer: Buffer): Promise<Map<number, string>> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer);
  const out = new Map<number, string>();

  const slidePaths = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => slideNumber(a) - slideNumber(b));

  for (let i = 0; i < slidePaths.length; i += 1) {
    const slideNum = i + 1;
    const slidePath = slidePaths[i]!;
    const relsPath = slidePath
      .replace("ppt/slides/", "ppt/slides/_rels/")
      .replace(".xml", ".xml.rels");
    const relsFile = zip.file(relsPath);

    let bestBytes: Buffer | null = null;
    let bestArea = 0;
    let bestMime = "image/png";

    if (relsFile) {
      const relsXml = await relsFile.async("text");
      const mediaNames = [
        ...relsXml.matchAll(/Target="\.\.\/media\/([^"]+)"/g),
      ].map((match) => match[1]!);

      for (const mediaName of mediaNames) {
        const mediaFile = zip.file(`ppt/media/${mediaName}`);
        if (!mediaFile) continue;
        const bytes = Buffer.from(await mediaFile.async("arraybuffer"));
        try {
          const { imageSize } = await import("image-size");
          const dims = imageSize(bytes);
          const area = (dims.width ?? 0) * (dims.height ?? 0);
          if (area > bestArea) {
            bestArea = area;
            bestBytes = bytes;
            bestMime = mimeFromName(mediaName);
          }
        } catch {
          if (!bestBytes) {
            bestBytes = bytes;
            bestMime = mimeFromName(mediaName);
          }
        }
      }
    }

    if (bestBytes && bestMime.startsWith("image/")) {
      out.set(slideNum, toDataUrl(bestBytes, bestMime));
    } else {
      out.set(slideNum, await createPlaceholderDataUrl(`Slide ${slideNum}`));
    }
  }

  return out;
}

/**
 * Render a single page/slide at viewer resolution for the "View source" panel.
 * Returns a data URL, or null when rendering isn't possible for the type.
 */
export async function renderSourcePageImage(
  buffer: Buffer,
  sourceType: SourceType,
  page: number,
  maxWidth = 900,
): Promise<string | null> {
  try {
    if (sourceType === "pdf") {
      const map = await renderPdfPageThumbnails(buffer, [page], maxWidth);
      return map.get(page) ?? null;
    }
    if (sourceType === "pptx") {
      const map = await extractPptxSlideThumbnails(buffer);
      return map.get(page) ?? null;
    }
    return null;
  } catch (error) {
    console.warn("[segment-thumbnails] page render failed:", error);
    return null;
  }
}

export async function buildDocumentSegmentPreviews(
  buffer: Buffer,
  sourceType: SourceType,
  chunkPreviews: SourceChunkPreview[],
): Promise<SourceChunkPreview[]> {
  if (sourceType !== "pdf" && sourceType !== "pptx") {
    return enrichChunkPreviews(chunkPreviews, new Map(), sourceType);
  }

  const pageNumbers = collectSegmentPageNumbers(chunkPreviews);
  if (pageNumbers.length === 0) {
    return enrichChunkPreviews(chunkPreviews, new Map(), sourceType);
  }

  try {
    const thumbnails =
      sourceType === "pdf"
        ? await renderPdfPageThumbnails(buffer, pageNumbers)
        : await extractPptxSlideThumbnails(buffer);
    return enrichChunkPreviews(chunkPreviews, thumbnails, sourceType);
  } catch (error) {
    console.warn("[segment-thumbnails] preview generation failed:", error);
    return enrichChunkPreviews(chunkPreviews, new Map(), sourceType);
  }
}
