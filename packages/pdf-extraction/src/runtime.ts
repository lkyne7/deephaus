type CanvasRuntime = typeof import("@napi-rs/canvas");
type PdfjsRuntime = typeof import("pdfjs-dist/legacy/build/pdf.mjs");

export async function loadCanvasRuntime(): Promise<CanvasRuntime> {
  const canvas = await import("@napi-rs/canvas");
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.DOMMatrix ??= canvas.DOMMatrix;
  globals.ImageData ??= canvas.ImageData;
  globals.Path2D ??= canvas.Path2D;
  return canvas;
}

export async function loadPdfjsRuntime(): Promise<PdfjsRuntime> {
  await loadCanvasRuntime();
  return import("pdfjs-dist/legacy/build/pdf.mjs");
}
