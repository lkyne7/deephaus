import { loadPdfjsRuntime } from "./runtime.js";
import type { PdfPageInspection } from "./types.js";

export type PageTextItem = {
  str: string;
  transform: number[];
  width?: number;
  height?: number;
};

export type PageInspectionInput = {
  pageNumber: number;
  width: number;
  height: number;
  items: PageTextItem[];
  imageOps: number;
  vectorOps: number;
};

type Line = { y: number; xs: number[]; text: string };

function pageLines(items: PageTextItem[]): Line[] {
  const lines: Line[] = [];
  for (const item of items) {
    const text = item.str.trim();
    if (!text) continue;
    const x = item.transform[4] ?? 0;
    const y = item.transform[5] ?? 0;
    let line = lines.find((candidate) => Math.abs(candidate.y - y) <= 3);
    if (!line) {
      line = { y, xs: [], text: "" };
      lines.push(line);
    }
    line.xs.push(x);
    line.text += `${line.text ? " " : ""}${text}`;
  }
  return lines;
}

function detectColumns(items: PageTextItem[], width: number): number {
  if (items.length < 8 || width <= 0) return 1;
  const left = items.filter((item) => (item.transform[4] ?? 0) < width * 0.42);
  const right = items.filter((item) => (item.transform[4] ?? 0) > width * 0.48);
  if (left.length < 4 || right.length < 4) return 1;
  const overlappingRows = right.filter((rightItem) =>
    left.some(
      (leftItem) =>
        Math.abs((leftItem.transform[5] ?? 0) - (rightItem.transform[5] ?? 0)) < 8,
    ),
  ).length;
  return overlappingRows >= Math.min(4, Math.floor(right.length / 2)) ? 2 : 1;
}

function countTableSignals(lines: Line[]): number {
  const aligned = lines.filter((line) => {
    const sorted = [...line.xs].sort((a, b) => a - b);
    let largeGaps = 0;
    for (let i = 1; i < sorted.length; i += 1) {
      if (sorted[i]! - sorted[i - 1]! > 32) largeGaps += 1;
    }
    return largeGaps >= 2;
  });
  return aligned.length;
}

export function inspectPageSignals(input: PageInspectionInput): PdfPageInspection {
  const lines = pageLines(input.items);
  const text = input.items.map((item) => item.str).join(" ");
  const textChars = text.replace(/\s/g, "").length;
  const replacementRate = textChars
    ? (text.match(/\uFFFD/g)?.length ?? 0) / textChars
    : 1;
  const columnCount = detectColumns(input.items, input.width);
  const mathSignals =
    text.match(/[∑∫√≈≠≤≥∞∂∇α-ωΑ-Ω]|\b(?:sin|cos|tan|lim)\s*\(/gu)?.length ?? 0;
  const tableSignals = countTableSignals(lines);
  const reasons: string[] = [];
  let qualityScore = 1;

  if (textChars < 40) {
    reasons.push("low-text-coverage");
    qualityScore -= 0.55;
  }
  if (replacementRate > 0.01) {
    reasons.push("malformed-characters");
    qualityScore -= Math.min(0.45, replacementRate * 4);
  }
  if (columnCount > 1) {
    reasons.push("multi-column-layout");
    qualityScore -= 0.25;
  }
  if (input.imageOps > 0) {
    reasons.push("embedded-images");
    qualityScore -= 0.25;
  }
  if (input.vectorOps > 1600) {
    reasons.push("dense-vector-content");
    qualityScore -= 0.2;
  }
  if (mathSignals >= 3) {
    reasons.push("math-heavy");
    qualityScore -= 0.25;
  }
  if (tableSignals >= 3) {
    reasons.push("table-like-layout");
    qualityScore -= 0.25;
  }

  qualityScore = Math.max(0, Math.min(1, qualityScore));
  return {
    pageNumber: input.pageNumber,
    route: qualityScore >= 0.75 && reasons.length === 0 ? "local" : "ocr",
    qualityScore,
    reasons,
    textChars,
    replacementRate,
    columnCount,
    imageOps: input.imageOps,
    vectorOps: input.vectorOps,
    mathSignals,
    tableSignals,
  };
}

export async function inspectPdf(data: Uint8Array): Promise<PdfPageInspection[]> {
  const { getDocument, OPS } = await loadPdfjsRuntime();
  // pdfjs transfers (and detaches) the input buffer to its worker.
  const loadingTask = getDocument({ data: data.slice(), useSystemFonts: true });
  const document = await loadingTask.promise;
  const inspections: PdfPageInspection[] = [];
  const op = OPS as unknown as Record<string, number>;
  const imageCodes = new Set(
    [
      op.paintImageXObject,
      op.paintInlineImageXObject,
      op.paintImageMaskXObject,
      op.paintSolidColorImageMask,
    ].filter((value): value is number => typeof value === "number"),
  );

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const [content, operators] = await Promise.all([
        page.getTextContent(),
        page.getOperatorList(),
      ]);
      const viewport = page.getViewport({ scale: 1 });
      const items: PageTextItem[] = content.items.flatMap((item) =>
        "str" in item && "transform" in item && Array.isArray(item.transform)
          ? [
              {
                str: item.str,
                transform: item.transform,
                width: item.width,
                height: item.height,
              },
            ]
          : [],
      );
      inspections.push(
        inspectPageSignals({
          pageNumber,
          width: viewport.width,
          height: viewport.height,
          items,
          imageOps: operators.fnArray.filter((code) => imageCodes.has(code)).length,
          vectorOps: operators.fnArray.length,
        }),
      );
      page.cleanup();
    }
  } finally {
    await loadingTask.destroy();
  }
  return inspections;
}
