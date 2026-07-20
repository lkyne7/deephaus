import { inspectPdf } from "./inspect.js";
import { extractLocalPages } from "./local.js";
import { extractMistralPages } from "./mistral.js";
import {
  EXTRACTION_VERSION,
  type ExtractedDocument,
  type ExtractedPage,
} from "./types.js";

function batches<T>(values: T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}

function normalizePage(page: ExtractedPage): ExtractedPage {
  const blocks = [...page.blocks]
    .sort((a, b) => a.order - b.order)
    .map((block, order) => ({ ...block, order }));
  return {
    ...page,
    blocks,
    markdown:
      page.markdown ||
      blocks.map((block) => block.markdown ?? block.text ?? "").filter(Boolean).join("\n\n"),
  };
}

export async function extractPdfHybrid(input: {
  data: Uint8Array;
  documentUrl?: string;
  mistralApiKey?: string;
  mistralModel?: string;
  includeImages?: boolean;
  batchSize?: number;
  ocrConcurrency?: number;
  onProgress?: (event: {
    phase: "inspecting" | "local" | "ocr";
    completed: number;
    total: number;
  }) => void | Promise<void>;
}): Promise<ExtractedDocument> {
  const inspections = await inspectPdf(input.data);
  await input.onProgress?.({
    phase: "inspecting",
    completed: 0,
    total: inspections.length,
  });
  const localNumbers = inspections
    .filter((inspection) => inspection.route === "local")
    .map((inspection) => inspection.pageNumber);
  const ocrNumbers = inspections
    .filter((inspection) => inspection.route === "ocr")
    .map((inspection) => inspection.pageNumber);

  const pages: ExtractedPage[] = await extractLocalPages(
    input.data,
    inspections,
    localNumbers,
    { includeImages: input.includeImages },
  );
  await input.onProgress?.({
    phase: "local",
    completed: pages.length,
    total: inspections.length,
  });

  const canUseOcr = Boolean(input.documentUrl && input.mistralApiKey);
  if (ocrNumbers.length && canUseOcr) {
    const queue = batches(ocrNumbers, Math.max(1, input.batchSize ?? 8));
    const workers = Math.max(1, Math.min(input.ocrConcurrency ?? 2, queue.length));
    const ocrPages: ExtractedPage[] = [];
    let cursor = 0;
    async function runBatchWorker() {
      for (;;) {
        const index = cursor;
        cursor += 1;
        const batch = queue[index];
        if (!batch) return;
        const extracted = await extractMistralPages({
          documentUrl: input.documentUrl!,
          pageNumbers: batch,
          inspections,
          apiKey: input.mistralApiKey!,
          model: input.mistralModel,
        });
        ocrPages.push(...extracted);
        await input.onProgress?.({
          phase: "ocr",
          completed: pages.length + ocrPages.length,
          total: inspections.length,
        });
      }
    }
    await Promise.allSettled(Array.from({ length: workers }, runBatchWorker));
    pages.push(...ocrPages);
    const extractedNumbers = new Set(ocrPages.map((page) => page.pageNumber));
    const missing = ocrNumbers.filter((pageNumber) => !extractedNumbers.has(pageNumber));
    if (missing.length) {
      const fallback = await extractLocalPages(input.data, inspections, missing, {
        provider: "local-fallback",
        includeImages: input.includeImages,
      });
      pages.push(...fallback);
      await input.onProgress?.({
        phase: "local",
        completed: pages.length,
        total: inspections.length,
      });
    }
  } else if (ocrNumbers.length) {
    const fallback = await extractLocalPages(input.data, inspections, ocrNumbers, {
      provider: "local-fallback",
      includeImages: input.includeImages,
    });
    pages.push(...fallback);
    await input.onProgress?.({
      phase: "local",
      completed: pages.length,
      total: inspections.length,
    });
  }

  return {
    version: EXTRACTION_VERSION,
    pageCount: inspections.length,
    pages: pages.sort((a, b) => a.pageNumber - b.pageNumber).map(normalizePage),
  };
}
