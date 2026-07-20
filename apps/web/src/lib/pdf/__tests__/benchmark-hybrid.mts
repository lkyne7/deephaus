import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  documentToPlainText,
  extractPdfHybrid,
  type ExtractedDocument,
} from "@deephaus/pdf-extraction";
import katex from "katex";
import { extractPdfText } from "../extract";

type Fixture = {
  name: string;
  file: string;
  documentUrl?: string;
  expectedPhrases?: string[];
  expectedEquations?: number;
  expectedTableRows?: number;
  expectedImages?: number;
};

type Manifest = { fixtures: Fixture[] };

function percentile(values: number[], percentileValue: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1)]!;
}

function textQuality(text: string, expected: string[]) {
  const normalized = text.toLowerCase();
  return {
    phraseRecall: expected.length
      ? expected.filter((phrase) => normalized.includes(phrase.toLowerCase())).length /
        expected.length
      : null,
    replacementRate: text.length
      ? (text.match(/\uFFFD/g)?.length ?? 0) / text.length
      : 1,
    nonWhitespaceCharacters: text.replace(/\s/g, "").length,
  };
}

function structureQuality(document: ExtractedDocument, fixture: Fixture) {
  const blocks = document.pages.flatMap((page) => page.blocks);
  const equations = blocks.filter((block) => block.kind === "equation");
  const validEquations = equations.filter((block) => {
    try {
      katex.renderToString(block.latex ?? "", { throwOnError: true });
      return true;
    } catch {
      return false;
    }
  }).length;
  const tableRows = blocks
    .filter((block) => block.kind === "table")
    .reduce(
      (count, block) =>
        count + ([...(block.html ?? "").matchAll(/<tr\b/gi)].length || 1),
      0,
    );
  const images = blocks.filter((block) => block.kind === "image").length;
  const expectedImages = fixture.expectedImages ?? 0;
  return {
    equations: equations.length,
    katexValidRate: equations.length ? validEquations / equations.length : 1,
    equationRecall:
      fixture.expectedEquations == null
        ? null
        : Math.min(1, equations.length / Math.max(1, fixture.expectedEquations)),
    tableRows,
    tableShapeRecall:
      fixture.expectedTableRows == null
        ? null
        : Math.min(1, tableRows / Math.max(1, fixture.expectedTableRows)),
    images,
    imageRecall:
      fixture.expectedImages == null
        ? null
        : expectedImages === 0
          ? 1
          : Math.min(1, images / expectedImages),
  };
}

const manifestPath = process.argv[2];
if (!manifestPath) {
  throw new Error(
    "Pass a benchmark manifest: pnpm --filter @deephaus/web benchmark:pdf -- path/to/manifest.json",
  );
}
const absoluteManifest = resolve(manifestPath);
const manifest = JSON.parse(await readFile(absoluteManifest, "utf8")) as Manifest;
const baseDirectory = dirname(absoluteManifest);
const results = [];

for (const fixture of manifest.fixtures) {
  const bytes = await readFile(resolve(baseDirectory, fixture.file));
  const legacyStarted = performance.now();
  let legacyText = "";
  let legacyError: string | null = null;
  try {
    legacyText = (await extractPdfText(bytes)).text;
  } catch (error) {
    legacyError = error instanceof Error ? error.message : "legacy extraction failed";
  }
  const legacyLatencyMs = performance.now() - legacyStarted;

  const hybridStarted = performance.now();
  const hybrid = await extractPdfHybrid({
    data: new Uint8Array(bytes),
    documentUrl: fixture.documentUrl,
    mistralApiKey: process.env.MISTRAL_API_KEY,
  });
  const hybridLatencyMs = performance.now() - hybridStarted;
  const hybridText = documentToPlainText(hybrid);
  const ocrPages = hybrid.pages.filter((page) => page.provider === "mistral-ocr").length;
  const pageCost = Number(process.env.MISTRAL_OCR_COST_PER_PAGE_USD);

  results.push({
    fixture: fixture.name,
    legacy: {
      latencyMs: Math.round(legacyLatencyMs),
      error: legacyError,
      ...textQuality(legacyText, fixture.expectedPhrases ?? []),
    },
    hybrid: {
      latencyMs: Math.round(hybridLatencyMs),
      ...textQuality(hybridText, fixture.expectedPhrases ?? []),
      ...structureQuality(hybrid, fixture),
      ocrPages,
      estimatedOcrCostUsd: Number.isFinite(pageCost)
        ? Number((ocrPages * pageCost).toFixed(6))
        : null,
    },
  });
}

const legacyLatencies = results.map((result) => result.legacy.latencyMs);
const hybridLatencies = results.map((result) => result.hybrid.latencyMs);
console.log(
  JSON.stringify(
    {
      summary: {
        fixtureCount: results.length,
        legacyLatencyMs: {
          p50: percentile(legacyLatencies, 0.5),
          p95: percentile(legacyLatencies, 0.95),
        },
        hybridLatencyMs: {
          p50: percentile(hybridLatencies, 0.5),
          p95: percentile(hybridLatencies, 0.95),
        },
        ocrPages: results.reduce((sum, result) => sum + result.hybrid.ocrPages, 0),
      },
      results,
    },
    null,
    2,
  ),
);
