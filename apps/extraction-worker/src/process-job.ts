import {
  documentToPlainText,
  documentToProseMirror,
  EXTRACTION_VERSION,
  extractPdfHybrid,
  shouldSeedExtractedContent,
  type ExtractedDocument,
} from "@deephaus/pdf-extraction";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkerConfig } from "./config.js";
import { updateJob, type ExtractionJobRow } from "./jobs.js";
import { downloadPdf, persistExtractedImages } from "./storage.js";

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
        inspection: page.inspection ?? null,
        normalized_blocks: page.blocks,
        markdown: page.markdown,
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

async function startRequestedGeneration(
  config: WorkerConfig,
  jobId: string,
): Promise<string> {
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
  };
  if (!response.ok || !payload.generation_job_id) {
    throw new Error(payload.error ?? `Could not start generation (${response.status}).`);
  }
  return payload.generation_job_id;
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

  try {
    let document = await extractPdfHybrid({
      data: downloaded.bytes,
      documentUrl: downloaded.signedUrl,
      mistralApiKey: config.mistralApiKey,
      mistralModel: config.mistralModel,
      includeImages: job.extract_images,
      onProgress: async ({ phase, completed, total }) => {
        const progress = Math.min(80, 8 + Math.round((completed / Math.max(1, total)) * 70));
        await updateJob(supabase, job.id, {
          phase,
          progress,
          pages_total: total,
          pages_completed: completed,
          heartbeat_at: new Date().toISOString(),
        });
      },
    });

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
          raw_text: rawText,
          page_count: document.pageCount,
          edited_content: editedContent,
        })
        .eq("id", job.source_id)
        .is("content_edited_at", null);
      if (sourceUpdateError) throw new Error(sourceUpdateError.message);
      await supabase.from("source_chunks").delete().eq("source_id", job.source_id);
    }

    let generationJobId: string | undefined;
    if (job.requested_generation?.generate) {
      await updateJob(supabase, job.id, {
        phase: "starting-generation",
        progress: 97,
      });
      generationJobId = await startRequestedGeneration(config, job.id);
    }
    await updateJob(supabase, job.id, {
      status: "ready",
      phase: "ready",
      progress: 100,
      pages_total: document.pageCount,
      pages_completed: document.pageCount,
      generation_job_id: generationJobId,
      heartbeat_at: new Date().toISOString(),
      error: null,
    });
  } finally {
    clearInterval(heartbeat);
    await downloaded.cleanup();
  }
}
