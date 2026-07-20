import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const originalGlobals = {
  DOMMatrix: globalThis.DOMMatrix,
  ImageData: globalThis.ImageData,
  Path2D: globalThis.Path2D,
};

afterEach(() => {
  Object.assign(globalThis, originalGlobals);
});

describe("PDF.js Node runtime", () => {
  it("installs canvas geometry globals before loading PDF.js", async () => {
    Object.assign(globalThis, {
      DOMMatrix: undefined,
      ImageData: undefined,
      Path2D: undefined,
    });

    const { loadPdfjsRuntime } = await import("../runtime");
    const { canvas, pdfjs } = await loadPdfjsRuntime();

    expect(globalThis.DOMMatrix).toBe(canvas.DOMMatrix);
    expect(globalThis.ImageData).toBe(canvas.ImageData);
    expect(globalThis.Path2D).toBe(canvas.Path2D);
    expect(typeof pdfjs.getDocument).toBe("function");
  });
});
