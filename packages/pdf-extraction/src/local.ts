import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type {
  ExtractedBlock,
  ExtractedPage,
  ExtractionProvider,
  PdfPageInspection,
} from "./types.js";

type PositionedText = {
  text: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  bold: boolean;
  italic: boolean;
};

type TextLine = {
  text: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  runs: Array<{ text: string; bold?: boolean; italic?: boolean }>;
};

function median(values: number[]): number {
  if (!values.length) return 12;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 12;
}

function buildLines(items: PositionedText[]): TextLine[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: PositionedText[][] = [];
  for (const item of sorted) {
    const line = lines.find((candidate) => Math.abs(candidate[0]!.y - item.y) <= 3);
    if (line) line.push(item);
    else lines.push([item]);
  }
  return lines.map((line) => {
    line.sort((a, b) => a.x - b.x);
    const runs = line.map((item, index) => {
      if (!index) {
        return {
          text: item.text,
          ...(item.bold ? { bold: true } : {}),
          ...(item.italic ? { italic: true } : {}),
        };
      }
      const previous = line[index - 1]!;
      const gap = item.x - (previous.x + previous.width);
      return {
        text: `${gap > Math.max(2, item.fontSize * 0.15) ? " " : ""}${item.text}`,
        ...(item.bold ? { bold: true } : {}),
        ...(item.italic ? { italic: true } : {}),
      };
    });
    const text = runs.map((run) => run.text).join("").trim();
    return {
      text,
      x: line[0]!.x,
      y: line[0]!.y,
      width: Math.max(...line.map((item) => item.x + item.width)) - line[0]!.x,
      fontSize: median(line.map((item) => item.fontSize)),
      runs,
    };
  });
}

function lineGroups(lines: TextLine[]): TextLine[][] {
  const groups: TextLine[][] = [];
  for (const line of lines) {
    if (!line.text) continue;
    const group = groups.at(-1);
    const previous = group?.at(-1);
    const gap = previous ? previous.y - line.y : Number.POSITIVE_INFINITY;
    const startsList = /^(?:[-•▪◦]|\d+[.)])\s+/.test(line.text);
    const previousList = previous
      ? /^(?:[-•▪◦]|\d+[.)])\s+/.test(previous.text)
      : false;
    if (
      group &&
      previous &&
      gap <= Math.max(previous.fontSize, line.fontSize) * 1.7 &&
      !startsList &&
      !previousList
    ) {
      group.push(line);
    } else {
      groups.push([line]);
    }
  }
  return groups;
}

function blocksFromLines(
  lines: TextLine[],
  pageNumber: number,
  pageWidth: number,
  pageHeight: number,
): ExtractedBlock[] {
  const bodySize = median(lines.map((line) => line.fontSize));
  return lineGroups(lines).map((group, order) => {
    const first = group[0]!;
    const text = group.map((line) => line.text).join(" ").replace(/-\s+/g, "");
    const runs = group.flatMap((line, index) => [
      ...(index ? [{ text: " " }] : []),
      ...line.runs,
    ]);
    const bbox = {
      x: Math.max(0, first.x),
      y: Math.max(0, pageHeight - first.y - first.fontSize),
      width: Math.min(pageWidth, Math.max(...group.map((line) => line.width))),
      height: Math.max(first.fontSize, first.y - group.at(-1)!.y + first.fontSize),
    };
    if (group.every((line) => /^(?:[-•▪◦]|\d+[.)])\s+/.test(line.text))) {
      const items = group.map((line) =>
        line.text.replace(/^(?:[-•▪◦]|\d+[.)])\s+/, "").trim(),
      );
      return {
        id: `p${pageNumber}-b${order}`,
        kind: "list" as const,
        order,
        text: items.join("\n"),
        items,
        markdown: items.map((item) => `- ${item}`).join("\n"),
        bbox,
        confidence: 0.92,
      };
    }
    if (first.fontSize >= bodySize * 1.24 && text.length <= 180) {
      const level = first.fontSize >= bodySize * 1.75 ? 1 : first.fontSize >= bodySize * 1.45 ? 2 : 3;
      return {
        id: `p${pageNumber}-b${order}`,
        kind: "heading" as const,
        order,
        text,
        level: level as 1 | 2 | 3,
        markdown: `${"#".repeat(level)} ${text}`,
        bbox,
        confidence: 0.9,
        runs,
      };
    }
    return {
      id: `p${pageNumber}-b${order}`,
      kind: "paragraph" as const,
      order,
      text,
      markdown: text,
      bbox,
      confidence: 0.9,
      runs,
    };
  });
}

export async function extractLocalPages(
  data: Uint8Array,
  inspections: PdfPageInspection[],
  pageNumbers: number[],
  options: { concurrency?: number; provider?: ExtractionProvider } = {},
): Promise<ExtractedPage[]> {
  // Keep the caller's buffer reusable across inspection, local extraction, and
  // fallback passes; pdfjs detaches the Uint8Array it receives.
  const loadingTask = getDocument({ data: data.slice(), useSystemFonts: true });
  const document = await loadingTask.promise;
  const inspectionByPage = new Map(inspections.map((item) => [item.pageNumber, item]));
  const results = new Map<number, ExtractedPage>();
  const queue = [...pageNumbers];
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 3, 6));

  async function worker() {
    for (;;) {
      const pageNumber = queue.shift();
      if (pageNumber == null) return;
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const viewport = page.getViewport({ scale: 1 });
      const items: PositionedText[] = content.items.flatMap((item) => {
        if (!("str" in item) || !item.str.trim()) return [];
        const transform = item.transform;
        const style = content.styles[item.fontName];
        const fontLabel = `${item.fontName} ${style?.fontFamily ?? ""}`;
        return [
          {
            text: item.str,
            x: transform[4] ?? 0,
            y: transform[5] ?? 0,
            width: item.width ?? 0,
            fontSize: Math.max(
              1,
              Math.abs(transform[0] ?? 0),
              Math.abs(transform[3] ?? 0),
            ),
            bold: /bold|black|semibold|demi/i.test(fontLabel),
            italic: /italic|oblique/i.test(fontLabel),
          },
        ];
      });
      const blocks = blocksFromLines(
        buildLines(items),
        pageNumber,
        viewport.width,
        viewport.height,
      );
      const inspection = inspectionByPage.get(pageNumber);
      results.set(pageNumber, {
        pageNumber,
        width: viewport.width,
        height: viewport.height,
        provider: options.provider ?? "local-pdfjs",
        qualityScore: inspection?.qualityScore ?? 0.7,
        blocks,
        markdown: blocks.map((block) => block.markdown ?? block.text ?? "").join("\n\n"),
        inspection,
      });
      page.cleanup();
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  } finally {
    await loadingTask.destroy();
  }
  return pageNumbers
    .map((pageNumber) => results.get(pageNumber))
    .filter((page): page is ExtractedPage => Boolean(page));
}
