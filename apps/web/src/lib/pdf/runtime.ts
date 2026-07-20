import "server-only";

type CanvasRuntime = typeof import("@napi-rs/canvas");
type PdfjsRuntime = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

/**
 * PDF.js 6 needs browser geometry globals in Node. Its optional canvas import
 * is not reliably traced into standalone/Vercel functions, so install the
 * globals from our direct dependency before importing PDF.js.
 */
export async function loadCanvasRuntime(): Promise<CanvasRuntime> {
  const canvas = await import("@napi-rs/canvas");
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.DOMMatrix ??= canvas.DOMMatrix;
  globals.ImageData ??= canvas.ImageData;
  globals.Path2D ??= canvas.Path2D;
  return canvas;
}

export async function loadPdfjsRuntime(): Promise<{
  canvas: CanvasRuntime;
  pdfjs: PdfjsRuntime;
}> {
  const canvas = await loadCanvasRuntime();
  // PDF.js dynamically imports this file when it falls back to an in-process
  // worker. Import it explicitly so Next/Vercel traces it into every function
  // that renders or inspects PDFs.
  // @ts-expect-error pdfjs-dist does not publish a declaration for this module.
  await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return { canvas, pdfjs };
}
