import { describe, expect, it } from "vitest";
import { inspectPageSignals, type PageTextItem } from "../inspect.js";

function item(str: string, x: number, y: number): PageTextItem {
  return { str, transform: [12, 0, 0, 12, x, y], width: str.length * 6 };
}

describe("PDF page router", () => {
  it("keeps high-confidence single-column text on the local path", () => {
    const items = Array.from({ length: 12 }, (_, index) =>
      item(`A clean line of born-digital text number ${index}.`, 60, 740 - index * 24),
    );
    const result = inspectPageSignals({
      pageNumber: 1,
      width: 612,
      height: 792,
      items,
      imageOps: 0,
      vectorOps: 180,
    });
    expect(result.route).toBe("local");
    expect(result.qualityScore).toBe(1);
  });

  it.each([
    ["scanned", [], 0, 12],
    ["figure", [item("A page with an important raster figure and supporting prose.", 60, 700)], 1, 120],
    [
      "math-heavy",
      [item("The result ∑ α ∫ x ∂ y ≈ ∞ is evaluated below with explanatory prose.", 60, 700)],
      0,
      120,
    ],
  ])("routes %s pages to OCR", (_name, items, imageOps, vectorOps) => {
    const result = inspectPageSignals({
      pageNumber: 1,
      width: 612,
      height: 792,
      items,
      imageOps,
      vectorOps,
    });
    expect(result.route).toBe("ocr");
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("detects a two-column page", () => {
    const items = Array.from({ length: 10 }, (_, index) => [
      item(`Left column line ${index} with enough readable text.`, 45, 740 - index * 25),
      item(`Right column line ${index} with enough readable text.`, 340, 740 - index * 25),
    ]).flat();
    const result = inspectPageSignals({
      pageNumber: 1,
      width: 612,
      height: 792,
      items,
      imageOps: 0,
      vectorOps: 320,
    });
    expect(result.columnCount).toBe(2);
    expect(result.route).toBe("ocr");
  });

  it("detects repeated aligned cells as a table", () => {
    const items = Array.from({ length: 5 }, (_, row) => [
      item(`row-${row}`, 40, 700 - row * 24),
      item(`${row * 10}`, 190, 700 - row * 24),
      item(`${row * 20}`, 360, 700 - row * 24),
    ]).flat();
    const result = inspectPageSignals({
      pageNumber: 1,
      width: 612,
      height: 792,
      items,
      imageOps: 0,
      vectorOps: 180,
    });
    expect(result.tableSignals).toBeGreaterThanOrEqual(3);
    expect(result.route).toBe("ocr");
  });
});
