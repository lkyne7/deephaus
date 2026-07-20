import type {
  ExtractedBlock,
  ExtractedBlockKind,
  ExtractedPage,
  PdfPageInspection,
} from "./types.js";

const DEFAULT_MODEL = "mistral-ocr-latest";
class NonRetryableOcrError extends Error {}

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  return value && typeof value === "object" ? (value as JsonObject) : {};
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function blockKind(type: string): ExtractedBlockKind {
  if (/title|heading/i.test(type)) return "heading";
  if (/formula|equation|math/i.test(type)) return "equation";
  if (/table/i.test(type)) return "table";
  if (/image|figure/i.test(type)) return "image";
  if (/caption/i.test(type)) return "caption";
  if (/list/i.test(type)) return "list";
  if (/code/i.test(type)) return "code";
  return "paragraph";
}

function cleanLatex(value: string): string {
  return value
    .replace(/^\s*\$\$?/, "")
    .replace(/\$\$?\s*$/, "")
    .replace(/^\\\[/, "")
    .replace(/\\\]$/, "")
    .trim();
}

function tableShape(html: string): { rowCount: number; columnCount: number } {
  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  return {
    rowCount: rows.length,
    columnCount: rows.reduce(
      (max, row) =>
        Math.max(max, [...row[1]!.matchAll(/<(?:td|th)\b/gi)].length),
      0,
    ),
  };
}

function blocksFromMarkdown(markdown: string, pageNumber: number): ExtractedBlock[] {
  return markdown
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part, order) => {
      const id = `p${pageNumber}-ocr-${order}`;
      const heading = /^(#{1,3})\s+(.+)/s.exec(part);
      if (heading) {
        return {
          id,
          kind: "heading" as const,
          order,
          text: heading[2]!.trim(),
          markdown: part,
          level: heading[1]!.length as 1 | 2 | 3,
        };
      }
      if (/^\$\$[\s\S]*\$\$$/.test(part) || /^\\\[[\s\S]*\\\]$/.test(part)) {
        return {
          id,
          kind: "equation" as const,
          order,
          latex: cleanLatex(part),
          markdown: part,
        };
      }
      if (/^<table[\s>]/i.test(part)) {
        return { id, kind: "table" as const, order, html: part, markdown: part };
      }
      const listLines = part.split("\n");
      if (listLines.every((line) => /^\s*(?:[-*+]|\d+[.)])\s+/.test(line))) {
        const items = listLines.map((line) =>
          line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").trim(),
        );
        return { id, kind: "list" as const, order, items, text: items.join("\n"), markdown: part };
      }
      return { id, kind: "paragraph" as const, order, text: part, markdown: part };
    });
}

function parseMistralPage(
  value: unknown,
  inspections: Map<number, PdfPageInspection>,
): ExtractedPage {
  const page = object(value);
  const pageNumber = (number(page.index) ?? number(page.page_number) ?? 0) + 1;
  const markdown = string(page.markdown) ?? "";
  const dimensions = object(page.dimensions);
  const rawBlocks = Array.isArray(page.blocks) ? page.blocks : [];
  const blocks: ExtractedBlock[] = rawBlocks.map((raw, order) => {
    const block = object(raw);
    const kind = blockKind(string(block.type) ?? "paragraph");
    const content =
      string(block.markdown) ??
      string(block.content) ??
      string(block.text) ??
      string(object(block.content).text) ??
      "";
    const bboxValue = object(block.bbox ?? block.bounding_box);
    const bbox =
      Object.keys(bboxValue).length > 0
        ? {
            x: number(bboxValue.x) ?? number(bboxValue.left) ?? 0,
            y: number(bboxValue.y) ?? number(bboxValue.top) ?? 0,
            width:
              number(bboxValue.width) ??
              Math.max(0, (number(bboxValue.right) ?? 0) - (number(bboxValue.left) ?? 0)),
            height:
              number(bboxValue.height) ??
              Math.max(0, (number(bboxValue.bottom) ?? 0) - (number(bboxValue.top) ?? 0)),
          }
        : undefined;
    return {
      id: string(block.id) ?? `p${pageNumber}-ocr-${order}`,
      kind,
      order,
      text: ["paragraph", "heading", "caption", "code"].includes(kind)
        ? content
        : undefined,
      markdown: string(block.markdown) ?? content,
      html: kind === "table" ? content : undefined,
      table: kind === "table" ? tableShape(content) : undefined,
      latex: kind === "equation" ? cleanLatex(content) : undefined,
      level:
        kind === "heading"
          ? (Math.max(1, Math.min(3, number(block.level) ?? 2)) as 1 | 2 | 3)
          : undefined,
      bbox,
      confidence:
        number(block.confidence) ??
        number(object(block.confidence).score) ??
        number(page.confidence),
    };
  });

  const images = Array.isArray(page.images) ? page.images : [];
  for (const rawImage of images) {
    const image = object(rawImage);
    const id = string(image.id) ?? string(image.image_id) ?? `image-${blocks.length}`;
    const base64 = string(image.image_base64) ?? string(image.base64);
    if (!base64) continue;
    const mime = string(image.mime_type) ?? "image/png";
    const extractedImage = {
      id,
      mime,
      dataUrl: base64.startsWith("data:") ? base64 : `data:${mime};base64,${base64}`,
      alt: string(image.alt_text) ?? string(image.caption) ?? `Figure on page ${pageNumber}`,
      width: number(image.width),
      height: number(image.height),
    };
    const existing = blocks.find(
      (block) =>
        block.kind === "image" &&
        (block.id === id || block.id.endsWith(`-${id}`) || block.markdown?.includes(id)),
    );
    if (existing) {
      existing.image = extractedImage;
      existing.markdown = `![${extractedImage.alt}](${id})`;
    } else {
      blocks.push({
        id: `p${pageNumber}-${id}`,
        kind: "image",
        order: blocks.length,
        image: extractedImage,
        markdown: `![${extractedImage.alt}](${id})`,
      });
    }
  }

  const tables = Array.isArray(page.tables) ? page.tables : [];
  for (const rawTable of tables) {
    const table = object(rawTable);
    const id = string(table.id) ?? `table-${blocks.length}`;
    if (blocks.some((block) => block.kind === "table" && block.id === id)) continue;
    const html = string(table.html) ?? string(table.content);
    if (!html) continue;
    blocks.push({
      id,
      kind: "table",
      order: blocks.length,
      html,
      table: tableShape(html),
      markdown: html,
      confidence: number(table.confidence),
    });
  }

  const resolvedBlocks = blocks.length ? blocks : blocksFromMarkdown(markdown, pageNumber);
  const inspection = inspections.get(pageNumber);
  return {
    pageNumber,
    width: number(dimensions.width) ?? number(page.width) ?? 0,
    height: number(dimensions.height) ?? number(page.height) ?? 0,
    provider: "mistral-ocr",
    qualityScore:
      number(page.confidence) ??
      number(object(page.confidence).score) ??
      Math.max(0.75, inspection?.qualityScore ?? 0.75),
    blocks: resolvedBlocks,
    markdown:
      markdown || resolvedBlocks.map((block) => block.markdown ?? block.text ?? "").join("\n\n"),
    inspection,
  };
}

async function requestWithRetry(
  url: string,
  init: RequestInit,
  retries: number,
): Promise<Response> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (response.ok) return response;
      const body = await response.text();
      if (response.status !== 429 && response.status < 500) {
        throw new NonRetryableOcrError(
          `Mistral OCR failed (${response.status}): ${body.slice(0, 300)}`,
        );
      }
      lastError = new Error(`Mistral OCR unavailable (${response.status})`);
      const retryAfter = Number(response.headers.get("retry-after"));
      await new Promise((resolve) =>
        setTimeout(resolve, Number.isFinite(retryAfter) ? retryAfter * 1000 : 750 * 2 ** attempt),
      );
    } catch (error) {
      if (error instanceof NonRetryableOcrError) throw error;
      lastError = error instanceof Error ? error : new Error("Mistral OCR request failed");
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 750 * 2 ** attempt));
      }
    }
  }
  throw lastError ?? new Error("Mistral OCR request failed");
}

export async function extractMistralPages(input: {
  documentUrl: string;
  pageNumbers: number[];
  inspections: PdfPageInspection[];
  apiKey: string;
  model?: string;
  retries?: number;
}): Promise<ExtractedPage[]> {
  if (!input.pageNumbers.length) return [];
  const response = await requestWithRetry(
    "https://api.mistral.ai/v1/ocr",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: input.model ?? DEFAULT_MODEL,
        document: { type: "document_url", document_url: input.documentUrl },
        pages: input.pageNumbers.map((page) => page - 1),
        include_blocks: true,
        include_confidence_scores: true,
        include_image_base64: true,
        table_format: "html",
        extract_header: true,
        extract_footer: true,
      }),
    },
    input.retries ?? 3,
  );
  const payload = object(await response.json());
  const pages = Array.isArray(payload.pages) ? payload.pages : [];
  const inspections = new Map(input.inspections.map((item) => [item.pageNumber, item]));
  return pages.map((page) => parseMistralPage(page, inspections));
}
