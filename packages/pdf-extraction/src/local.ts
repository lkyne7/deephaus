import { loadCanvasRuntime, loadPdfjsRuntime } from "./runtime.js";
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

type Matrix = [number, number, number, number, number, number];
type PdfImageObject = {
  width?: number;
  height?: number;
  kind?: number;
  data?: Uint8Array | Uint8ClampedArray;
};
type PdfPage = {
  view: number[];
  getOperatorList(): Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  objs: { get(name: string, callback?: (value: unknown) => void): unknown };
  commonObjs: { get(name: string, callback?: (value: unknown) => void): unknown };
  getViewport(options: { scale: number }): { width: number; height: number };
  render(options: Record<string, unknown>): { promise: Promise<void> };
};

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const MIN_IMAGE_PIXELS = 110;
const MIN_DISPLAY_PT = 50;
const MAX_IMAGE_AREA = 16_000_000;
const MAX_PAGE_COVERAGE = 0.85;
const PAGE_RENDER_MAX_WIDTH = 1400;

function concat(outer: Matrix, inner: Matrix): Matrix {
  return [
    outer[0] * inner[0] + outer[2] * inner[1],
    outer[1] * inner[0] + outer[3] * inner[1],
    outer[0] * inner[2] + outer[2] * inner[3],
    outer[1] * inner[2] + outer[3] * inner[3],
    outer[0] * inner[4] + outer[2] * inner[5] + outer[4],
    outer[1] * inner[4] + outer[3] * inner[5] + outer[5],
  ];
}

function applyMatrix(matrix: Matrix, x: number, y: number): [number, number] {
  return [
    matrix[0] * x + matrix[2] * y + matrix[4],
    matrix[1] * x + matrix[3] * y + matrix[5],
  ];
}

function imageRegion(
  matrix: Matrix,
  page: { left: number; top: number; width: number; height: number },
) {
  const corners = [
    applyMatrix(matrix, 0, 0),
    applyMatrix(matrix, 1, 0),
    applyMatrix(matrix, 0, 1),
    applyMatrix(matrix, 1, 1),
  ];
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    x: minX - page.left,
    y: page.top - maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function getPdfObject(page: PdfPage, name: string): Promise<unknown> {
  const store = name.startsWith("g_") ? page.commonObjs : page.objs;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 3000);
    try {
      store.get(name, (value: unknown) => {
        clearTimeout(timer);
        resolve(value);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

async function imagePaintRefs(
  page: PdfPage,
  ops: Record<string, number>,
): Promise<Array<{ object: string | PdfImageObject; matrix: Matrix }>> {
  const operators = await page.getOperatorList();
  const refs: Array<{ object: string | PdfImageObject; matrix: Matrix }> = [];
  const stack: Matrix[] = [];
  let matrix: Matrix = [...IDENTITY];
  for (let index = 0; index < operators.fnArray.length; index += 1) {
    const fn = operators.fnArray[index];
    const args = operators.argsArray[index] ?? [];
    if (fn === ops.save) {
      stack.push([...matrix]);
    } else if (fn === ops.restore) {
      matrix = stack.pop() ?? [...IDENTITY];
    } else if (fn === ops.transform) {
      matrix = concat(matrix, args as unknown as Matrix);
    } else if (fn === ops.paintImageXObject && typeof args[0] === "string") {
      refs.push({ object: args[0], matrix: [...matrix] });
    } else if (fn === ops.paintInlineImageXObject && args[0]) {
      refs.push({ object: args[0] as PdfImageObject, matrix: [...matrix] });
    }
  }
  return refs;
}

async function imageDataUrl(image: PdfImageObject): Promise<string | null> {
  const width = image.width ?? 0;
  const height = image.height ?? 0;
  const data = image.data;
  if (!width || !height || !data || width * height > MAX_IMAGE_AREA) return null;

  const kind =
    image.kind ??
    (data.length >= width * height * 4
      ? 3
      : data.length >= width * height * 3
        ? 2
        : data.length >= Math.ceil(width / 8) * height
          ? 1
          : 0);
  const rgba = new Uint8ClampedArray(width * height * 4);
  if (kind === 3 && data.length >= width * height * 4) {
    rgba.set(data.subarray(0, width * height * 4));
  } else if (kind === 2 && data.length >= width * height * 3) {
    for (let pixel = 0, source = 0; pixel < width * height; pixel += 1, source += 3) {
      const destination = pixel * 4;
      rgba[destination] = data[source]!;
      rgba[destination + 1] = data[source + 1]!;
      rgba[destination + 2] = data[source + 2]!;
      rgba[destination + 3] = 255;
    }
  } else if (kind === 1) {
    const rowBytes = Math.ceil(width / 8);
    if (data.length < rowBytes * height) return null;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const value = (data[y * rowBytes + (x >> 3)]! >> (7 - (x & 7))) & 1 ? 255 : 0;
        const destination = (y * width + x) * 4;
        rgba[destination] = value;
        rgba[destination + 1] = value;
        rgba[destination + 2] = value;
        rgba[destination + 3] = 255;
      }
    }
  } else {
    return null;
  }

  const { createCanvas } = await loadCanvasRuntime();
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  const canvasImage = context.createImageData(width, height);
  canvasImage.data.set(rgba);
  context.putImageData(canvasImage, 0, 0);
  return `data:image/png;base64,${canvas.toBuffer("image/png").toString("base64")}`;
}

async function renderPageImage(
  page: PdfPage,
  pageNumber: number,
): Promise<ExtractedBlock> {
  const { createCanvas } = await loadCanvasRuntime();
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(2, PAGE_RENDER_MAX_WIDTH / base.width);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({
    canvas,
    canvasContext: context,
    viewport,
  }).promise;
  const id = `p${pageNumber}-render`;
  return {
    id,
    kind: "image",
    order: 0,
    image: {
      id,
      mime: "image/png",
      dataUrl: `data:image/png;base64,${canvas.toBuffer("image/png").toString("base64")}`,
      alt: `Page ${pageNumber} image`,
      width: canvas.width,
      height: canvas.height,
    },
    bbox: { x: 0, y: 0, width: base.width, height: base.height },
    markdown: `![Page ${pageNumber} image](${id})`,
  };
}

async function extractPageImages(
  page: PdfPage,
  pageNumber: number,
  inspection: PdfPageInspection | undefined,
  ops: Record<string, number>,
): Promise<ExtractedBlock[]> {
  const [x0, y0, x1, y1] = page.view;
  const pageSize = {
    left: x0 ?? 0,
    top: y1 ?? 792,
    width: (x1 ?? 612) - (x0 ?? 0),
    height: (y1 ?? 792) - (y0 ?? 0),
  };
  const pageArea = Math.max(1, pageSize.width * pageSize.height);
  const blocks: ExtractedBlock[] = [];
  let sawPageImage = false;
  const refs = await imagePaintRefs(page, ops);

  for (const ref of refs) {
    const region = imageRegion(ref.matrix, pageSize);
    if (region.width < MIN_DISPLAY_PT || region.height < MIN_DISPLAY_PT) continue;
    if ((region.width * region.height) / pageArea >= MAX_PAGE_COVERAGE) {
      sawPageImage = true;
      continue;
    }
    const image =
      typeof ref.object === "string"
        ? ((await getPdfObject(page, ref.object)) as PdfImageObject | null)
        : ref.object;
    if (!image || Math.max(image.width ?? 0, image.height ?? 0) < MIN_IMAGE_PIXELS) continue;
    const dataUrl = await imageDataUrl(image);
    if (!dataUrl) continue;
    const id = `p${pageNumber}-image-${blocks.length + 1}`;
    const alt = `Figure on page ${pageNumber}`;
    blocks.push({
      id,
      kind: "image",
      order: 0,
      image: {
        id,
        mime: "image/png",
        dataUrl,
        alt,
        width: image.width,
        height: image.height,
      },
      bbox: region,
      markdown: `![${alt}](${id})`,
    });
  }

  const shouldRenderFallback =
    blocks.length === 0 &&
    (sawPageImage ||
      (inspection?.textChars ?? 0) < 100 ||
      (inspection?.vectorOps ?? 0) > 1600);
  if (shouldRenderFallback) blocks.push(await renderPageImage(page, pageNumber));
  return blocks;
}

export async function extractLocalPages(
  data: Uint8Array,
  inspections: PdfPageInspection[],
  pageNumbers: number[],
  options: {
    concurrency?: number;
    provider?: ExtractionProvider;
    includeImages?: boolean;
  } = {},
): Promise<ExtractedPage[]> {
  const { pdfjs, documentOptions } = await loadPdfjsRuntime();
  const { getDocument, OPS } = pdfjs;
  // Keep the caller's buffer reusable across inspection, local extraction, and
  // fallback passes; pdfjs detaches the Uint8Array it receives.
  const loadingTask = getDocument({
    ...documentOptions,
    data: data.slice(),
    useSystemFonts: true,
  });
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
      if (options.includeImages) {
        const imageBlocks = await extractPageImages(
          page as unknown as PdfPage,
          pageNumber,
          inspection,
          OPS as unknown as Record<string, number>,
        );
        blocks.push(...imageBlocks);
        blocks.sort(
          (left, right) =>
            (left.bbox?.y ?? Number.POSITIVE_INFINITY) -
            (right.bbox?.y ?? Number.POSITIVE_INFINITY),
        );
        blocks.forEach((block, order) => {
          block.order = order;
        });
      }
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
