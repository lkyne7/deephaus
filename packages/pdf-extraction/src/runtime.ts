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

export async function loadCanvasRuntime(): Promise<CanvasRuntime> {
  const canvas = await import("@napi-rs/canvas");
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.DOMMatrix ??= canvas.DOMMatrix;
  globals.ImageData ??= canvas.ImageData;
  globals.Path2D ??= canvas.Path2D;
  return canvas;
}

export async function loadPdfjsRuntime(): Promise<{
  pdfjs: PdfjsRuntime;
  documentOptions: { wasmUrl: string; useWasm: false };
}> {
  await loadCanvasRuntime();
  // pdfjs-dist ships the worker module without a matching declaration file.
  // @ts-expect-error Runtime module is present and intentionally imported for tracing.
  await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return {
    pdfjs,
    documentOptions: { wasmUrl: resolveWasmUrl(), useWasm: false },
  };
}
