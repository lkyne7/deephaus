import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cleanup,
  extractPdfHybrid,
  reserveWorkerCredits,
  settleWorkerCredits,
  updateJob,
} = vi.hoisted(() => ({
  cleanup: vi.fn(),
  extractPdfHybrid: vi.fn(),
  reserveWorkerCredits: vi.fn(),
  settleWorkerCredits: vi.fn(),
  updateJob: vi.fn(),
}));

vi.mock("@deephaus/pdf-extraction", () => ({
  EXTRACTION_VERSION: "pdf-test",
  documentToPlainText: () => "A sufficiently long extracted document body.",
  documentToProseMirror: () => ({ type: "doc", content: [] }),
  extractPdfHybrid,
  sanitizeForPostgres: (value: unknown) => value,
  shouldSeedExtractedContent: () => true,
}));
vi.mock("../credits.js", () => ({
  reserveWorkerCredits,
  settleWorkerCredits,
}));
vi.mock("../jobs.js", () => ({ updateJob }));
vi.mock("../storage.js", () => ({
  downloadPdf: vi.fn(async () => ({
    bytes: Buffer.from("pdf"),
    signedUrl: "https://storage.test/source.pdf",
    cleanup,
  })),
  persistExtractedImages: vi.fn(async (_client, _user, _source, document) => document),
}));

import { processJob } from "../process-job.js";
import type { ExtractionJobRow } from "../jobs.js";

const document = {
  version: "pdf-test",
  pageCount: 1,
  pages: [
    {
      pageNumber: 1,
      width: 100,
      height: 100,
      provider: "mistral-ocr",
      qualityScore: 0.9,
      blocks: [
        {
          id: "block-1",
          kind: "paragraph",
          order: 0,
          text: "A sufficiently long extracted document body.",
        },
      ],
      markdown: "A sufficiently long extracted document body.",
    },
  ],
};

function job(overrides: Partial<ExtractionJobRow> = {}): ExtractionJobRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    source_id: "22222222-2222-4222-8222-222222222222",
    kind: "extract",
    storage_path: "user/source.pdf",
    filename: "source.pdf",
    file_size: 100,
    status: "processing",
    phase: "starting",
    progress: 0,
    pages_total: null,
    pages_completed: 0,
    requested_generation: null,
    extract_images: false,
    attempts: 2,
    ...overrides,
  };
}

function client(options: { cached?: boolean } = {}) {
  const events: string[] = [];
  const pageRows = options.cached
    ? [
        {
          page_number: 1,
          extractor: "mistral-ocr",
          extractor_version: "pdf-test",
          quality_score: 0.9,
          inspection: null,
          normalized_blocks: document.pages[0]!.blocks,
          markdown: document.pages[0]!.markdown,
        },
      ]
    : [];

  return {
    events,
    supabase: {
      from: vi.fn((table: string) => {
        if (table === "sources") {
          const query = {
            select: vi.fn(() => query),
            eq: vi.fn(() => query),
            single: vi.fn(async () => ({
              data: {
                id: job().source_id,
                content_edited_at: null,
                projects: { user_id: "user-1" },
              },
              error: null,
            })),
            update: vi.fn(() => query),
            is: vi.fn(async () => ({ error: null })),
          };
          return query;
        }
        if (table === "source_extraction_pages") {
          const query = {
            select: vi.fn(() => query),
            eq: vi.fn(() => query),
            order: vi.fn(async () => ({ data: pageRows, error: null })),
            upsert: vi.fn(async () => {
              events.push("persist-page");
              return { error: null };
            }),
          };
          return query;
        }
        if (table === "source_chunks") {
          return {
            delete: vi.fn(() => ({
              eq: vi.fn(async () => ({ error: null })),
            })),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
    },
  };
}

const config = {
  appBaseUrl: "https://app.test",
  workerSecret: "worker-secret",
  mistralApiKey: "mistral-key",
  mistralModel: "mistral-ocr-latest",
  tempDir: "/tmp",
} as never;

describe("OCR credit lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    extractPdfHybrid.mockImplementation(async (options) => {
      await options.onOcrPlan?.([1]);
      return document;
    });
    reserveWorkerCredits.mockResolvedValue("credit-1");
    settleWorkerCredits.mockResolvedValue(undefined);
    updateJob.mockResolvedValue(undefined);
  });

  it("uses a retry-stable key and settles only after page persistence", async () => {
    const { supabase, events } = client();
    settleWorkerCredits.mockImplementation(async () => {
      events.push("settle");
    });

    await processJob(supabase as never, config, job());

    expect(reserveWorkerCredits).toHaveBeenCalledWith(
      supabase,
      expect.objectContaining({
        idempotencyKey: `pdf-ocr:${job().id}`,
        resourceId: job().id,
      }),
    );
    expect(events.indexOf("persist-page")).toBeGreaterThanOrEqual(0);
    expect(events.indexOf("settle")).toBeGreaterThan(
      events.lastIndexOf("persist-page"),
    );
  });

  it("reuses persisted OCR pages on retry and preserves extraction on generation 402", async () => {
    const { supabase } = client({ cached: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            error: "AI credits exhausted.",
            code: "AI_CREDITS_EXHAUSTED",
          },
          { status: 402 },
        ),
      ),
    );

    await processJob(
      supabase as never,
      config,
      job({
        pages_total: 1,
        credit_transaction_id: "credit-1",
        requested_generation: { generate: true },
      }),
    );

    expect(extractPdfHybrid).not.toHaveBeenCalled();
    expect(settleWorkerCredits).toHaveBeenCalledWith(
      supabase,
      "credit-1",
      4,
    );
    expect(updateJob).toHaveBeenCalledWith(
      supabase,
      job().id,
      expect.objectContaining({
        status: "ready",
        generation_status: "quota_exhausted",
        generation_error: "AI credits exhausted.",
      }),
    );
  });
});
