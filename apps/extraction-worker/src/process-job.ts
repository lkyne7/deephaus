import {
  documentToPlainText,
  documentToProseMirror,
  EXTRACTION_VERSION,
  extractPdfHybrid,
  sanitizeForPostgres,
  shouldSeedExtractedContent,
  type ExtractedDocument,
} from "@deephaus/pdf-extraction";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkerConfig } from "./config.js";
import {
  reserveWorkerCredits,
  settleWorkerCredits,
} from "./credits.js";
import { updateJob, type ExtractionJobRow } from "./jobs.js";
import { downloadPdf, persistExtractedImages } from "./storage.js";

const OCR_CREDITS_PER_PAGE = 4;

function userIdFromSource(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const projects = (value as { projects?: unknown }).projects;
  const project = Array.isArray(projects) ? projects[0] : projects;
  if (!project || typeof project !== "object") return null;
  const userId = (project as { user_id?: unknown }).user_id;
  return typeof userId === "string" ? userId : null;
}

async function persistPages(
  supabase: SupabaseClient,
  job: ExtractionJobRow,
  document: ExtractedDocument,
): Promise<void> {
  for (let index = 0; index < document.pages.length; index += 1) {
    const page = document.pages[index]!;
    const route =
      page.provider === "mistral-ocr"
        ? "ocr"
        : page.provider === "local-fallback"
          ? "fallback"
          : "local";
    const { error } = await supabase.from("source_extraction_pages").upsert(
      {
        job_id: job.id,
        source_id: job.source_id,
        page_number: page.pageNumber,
        extractor: page.provider,
        extractor_version: document.version,
        route,
        quality_score: page.qualityScore,
        inspection: sanitizeForPostgres(page.inspection ?? null),
        // NULs from PDF text break Postgres jsonb ("unsupported Unicode escape sequence").
        normalized_blocks: sanitizeForPostgres(page.blocks),
        markdown: sanitizeForPostgres(page.markdown),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "job_id,page_number" },
    );
    if (error) throw new Error(error.message);
    await updateJob(supabase, job.id, {
      phase: "persisting",
      pages_completed: index + 1,
      progress: 82 + Math.round(((index + 1) / document.pages.length) * 10),
      heartbeat_at: new Date().toISOString(),
    });
  }
}

async function loadPersistedDocument(
  supabase: SupabaseClient,
  job: ExtractionJobRow,
): Promise<ExtractedDocument | null> {
  if (!job.pages_total || job.pages_total <= 0) return null;
  const { data, error } = await supabase
    .from("source_extraction_pages")
    .select(
      "page_number,extractor,extractor_version,quality_score,inspection,normalized_blocks,markdown",
    )
    .eq("job_id", job.id)
    .order("page_number", { ascending: true });
  if (error) throw new Error(error.message);
  if (!data || data.length !== job.pages_total) return null;

  return {
    version: String(data[0]?.extractor_version ?? EXTRACTION_VERSION),
    pageCount: data.length,
    pages: data.map((row) => ({
      pageNumber: Number(row.page_number),
      width: 0,
      height: 0,
      provider: row.extractor as ExtractedDocument["pages"][number]["provider"],
      qualityScore: Number(row.quality_score ?? 0),
      blocks:
        row.normalized_blocks as ExtractedDocument["pages"][number]["blocks"],
      markdown: String(row.markdown ?? ""),
      inspection:
        (row.inspection as ExtractedDocument["pages"][number]["inspection"]) ??
        undefined,
    })),
  };
}

type GenerationStartResult =
  | { generationJobId: string; quotaError?: never }
  | { generationJobId?: never; quotaError: string };

async function startRequestedGeneration(
  config: WorkerConfig,
  jobId: string,
): Promise<GenerationStartResult> {
  const response = await fetch(`${config.appBaseUrl}/api/internal/source-extraction/complete`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.workerSecret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ extraction_job_id: jobId }),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    generation_job_id?: string;
    error?: string;
    code?: string;
  };
  if (response.status === 402) {
    return {
      quotaError:
        payload.error ??
        "Extraction completed, but generation could not start because AI credits are exhausted.",
    };
  }
  if (!response.ok || !payload.generation_job_id) {
    throw new Error(payload.error ?? `Could not start generation (${response.status}).`);
  }
  return { generationJobId: payload.generation_job_id };
}

export async function processJob(
  supabase: SupabaseClient,
  config: WorkerConfig,
  job: ExtractionJobRow,
): Promise<void> {
  const { data: source, error: sourceError } = await supabase
    .from("sources")
    .select("id, content_edited_at, projects!inner(user_id)")
    .eq("id", job.source_id)
    .single();
  if (sourceError || !source) throw new Error(sourceError?.message ?? "Source not found.");
  const userId = userIdFromSource(source);
  if (!userId) throw new Error("Source owner could not be resolved.");

  await updateJob(supabase, job.id, { phase: "downloading", progress: 2 });
  const downloaded = await downloadPdf(supabase, job.storage_path, config.tempDir);
  const heartbeat = setInterval(() => {
    void updateJob(supabase, job.id, {
      heartbeat_at: new Date().toISOString(),
    }).catch(() => undefined);
  }, 30_000);
  let ocrCreditTransactionId: string | null =
    job.credit_transaction_id ?? null;

  try {
    let document = await loadPersistedDocument(supabase, job);
    if (!document) {
      document = await extractPdfHybrid({
        data: downloaded.bytes,
        documentUrl: downloaded.signedUrl,
        mistralApiKey: config.mistralApiKey,
        mistralModel: config.mistralModel,
        includeImages: job.extract_images,
        onOcrPlan: async (pageNumbers) => {
          ocrCreditTransactionId = await reserveWorkerCredits(supabase, {
            userId,
            idempotencyKey: `pdf-ocr:${job.id}`,
            action: "pdf_ocr",
            credits: pageNumbers.length * OCR_CREDITS_PER_PAGE,
            resourceType: "source_extraction_job",
            resourceId: job.id,
            metadata: { pageNumbers },
          });
          await updateJob(supabase, job.id, {
            credit_transaction_id: ocrCreditTransactionId,
          });
        },
        onProgress: async ({ phase, completed, total }) => {
          const progress = Math.min(
            80,
            8 + Math.round((completed / Math.max(1, total)) * 70),
          );
          await updateJob(supabase, job.id, {
            phase,
            progress,
            pages_total: total,
            pages_completed: completed,
            heartbeat_at: new Date().toISOString(),
          });
        },
      });

      // Persist raw OCR output before any downstream image/source/generation
      // work. A transient retry can reconstruct the document from these rows
      // without invoking the OCR vendor again.
      await persistPages(supabase, job, document);
    }

    if (job.extract_images) {
      document = await persistExtractedImages(supabase, userId, job.source_id, document);
    } else {
      document = {
        ...document,
        pages: document.pages.map((page) => ({
          ...page,
          blocks: page.blocks.filter((block) => block.kind !== "image"),
        })),
      };
    }

    // Persist the final image-normalized form (an idempotent upsert).
    await persistPages(supabase, job, document);
    const rawText = documentToPlainText(document);
    const imageCount = document.pages.reduce(
      (count, page) =>
        count + page.blocks.filter((block) => block.kind === "image").length,
      0,
    );
    if (
      rawText.replace(/--- Page \d+ ---/g, "").trim().length < 20 &&
      imageCount === 0
    ) {
      throw new Error(
        "The PDF did not contain enough extractable text. OCR may be unavailable for this document.",
      );
    }
    const editedContent = documentToProseMirror(document);
    const quality =
      document.pages.reduce((sum, page) => sum + page.qualityScore, 0) /
      Math.max(1, document.pages.length);

    await updateJob(supabase, job.id, {
      phase: "finalizing",
      progress: 94,
      extractor_version: EXTRACTION_VERSION,
      quality_score: quality,
    });
    const contentEditedAt = (source as { content_edited_at?: string | null })
      .content_edited_at;
    if (shouldSeedExtractedContent(contentEditedAt)) {
      const { error: sourceUpdateError } = await supabase
        .from("sources")
        .update({
          raw_text: sanitizeForPostgres(rawText),
          page_count: document.pageCount,
          edited_content: sanitizeForPostgres(editedContent),
        })
        .eq("id", job.source_id)
        .is("content_edited_at", null);
      if (sourceUpdateError) throw new Error(sourceUpdateError.message);
      await supabase.from("source_chunks").delete().eq("source_id", job.source_id);
    }

    let generationJobId: string | undefined;
    let generationStatus:
      | "not_requested"
      | "pending"
      | "started"
      | "quota_exhausted"
      | "failed" = job.requested_generation?.generate
        ? "pending"
        : "not_requested";
    let generationError: string | null = null;
    if (job.requested_generation?.generate) {
      await updateJob(supabase, job.id, {
        phase: "starting-generation",
        progress: 97,
      });
      const generation = await startRequestedGeneration(config, job.id);
      generationJobId = generation.generationJobId;
      if (generation.quotaError) {
        generationStatus = "quota_exhausted";
        generationError = generation.quotaError;
      } else {
        generationStatus = "started";
      }
    }

    // Settlement is deliberately after page/source persistence and follow-on
    // generation handoff. Until this point transient failures keep the stable
    // reservation open so the retry can reuse cached OCR output.
    if (ocrCreditTransactionId) {
      const ocrPageCount = document.pages.filter(
        (page) => page.provider === "mistral-ocr",
      ).length;
      await settleWorkerCredits(
        supabase,
        ocrCreditTransactionId,
        ocrPageCount * OCR_CREDITS_PER_PAGE,
      );
    }

    await updateJob(supabase, job.id, {
      status: "ready",
      phase: "ready",
      progress: 100,
      pages_total: document.pageCount,
      pages_completed: document.pageCount,
      generation_job_id: generationJobId,
      generation_status: generationStatus,
      generation_error: generationError,
      heartbeat_at: new Date().toISOString(),
      error: null,
    });
  } finally {
    clearInterval(heartbeat);
    await downloaded.cleanup();
  }
}
