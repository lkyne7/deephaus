import "server-only";
import { createRequire } from "node:module";
import { dirname, sep } from "node:path";
import { pathToFileURL } from "node:url";

type CanvasRuntime = typeof import("@napi-rs/canvas");
type PdfjsRuntime = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

function resolveWasmUrl(): string {
  const require = createRequire(import.meta.url);
  const fallbackPath = require.resolve(
    "pdfjs-dist/wasm/openjpeg_nowasm_fallback.js",
  );
  return pathToFileURL(`${dirname(fallbackPath)}${sep}`).href;
}

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
  documentOptions: { wasmUrl: string; useWasm: false };
}> {
  const canvas = await loadCanvasRuntime();
  // PDF.js dynamically imports this file when it falls back to an in-process
  // worker. Import it explicitly so Next/Vercel traces it into every function
  // that renders or inspects PDFs.
  // @ts-expect-error pdfjs-dist does not publish a declaration for this module.
  await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return {
    canvas,
    pdfjs,
    // PDF.js uses this directory for JPEG 2000/OpenJPEG decoding. Without it,
    // image-heavy medical PDFs silently lose every JPX image.
    // This pdfjs-dist release ships the JS fallback but not openjpeg.wasm.
    documentOptions: { wasmUrl: resolveWasmUrl(), useWasm: false },
  };
}
