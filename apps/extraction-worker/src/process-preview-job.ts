import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkerConfig } from "./config.js";
import { updateJob, type ExtractionJobRow } from "./jobs.js";
import { downloadPdf } from "./storage.js";

const execFileAsync = promisify(execFile);
const SOURCE_BUCKET = "pdfs";
const CONVERT_TIMEOUT_MS = 4 * 60 * 1000;

export function extensionForFilename(filename: string): string {
  const match = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
  const ext = match?.[1];
  return ext === "pptx" || ext === "ppt" || ext === "doc" || ext === "docx" ? ext : "docx";
}

/**
 * Convert an Office document to PDF with headless LibreOffice. The output PDF
 * lands next to the input file in `outDir` with the same basename.
 */
export async function convertToPdf(inputPath: string, outDir: string): Promise<string> {
  await execFileAsync(
    "soffice",
    [
      "--headless",
      "--norestore",
      "--convert-to",
      "pdf",
      "--outdir",
      outDir,
      inputPath,
    ],
    {
      timeout: CONVERT_TIMEOUT_MS,
      // Isolated profile dir avoids lock contention between conversions.
      env: { ...process.env, HOME: outDir },
    },
  );
  const produced = join(outDir, basename(inputPath).replace(/\.[a-z0-9]+$/i, ".pdf"));
  const bytes = await readFile(produced);
  if (bytes.length === 0) throw new Error("LibreOffice produced an empty PDF.");
  return produced;
}

/**
 * Preview jobs (`kind = 'preview'`): render a DOCX/PPTX original into a PDF the
 * browser can display inline, stored beside the original in the private bucket.
 */
export async function processPreviewJob(
  supabase: SupabaseClient,
  _config: WorkerConfig,
  job: ExtractionJobRow,
): Promise<void> {
  const scratch = await mkdtemp(join(tmpdir(), "preview-"));
  await updateJob(supabase, job.id, { phase: "downloading", progress: 10 });
  const downloaded = await downloadPdf(
    supabase,
    job.storage_path,
    scratch,
    extensionForFilename(job.filename),
  );
  try {
    await updateJob(supabase, job.id, { phase: "converting", progress: 35 });
    const pdfPath = await convertToPdf(downloaded.path, scratch);
    const pdfBytes = await readFile(pdfPath);

    await updateJob(supabase, job.id, { phase: "uploading", progress: 75 });
    const previewPath = `${job.storage_path}.preview.pdf`;
    const { error: uploadError } = await supabase.storage
      .from(SOURCE_BUCKET)
      .upload(previewPath, pdfBytes, {
        contentType: "application/pdf",
        upsert: true,
        cacheControl: "3600",
      });
    if (uploadError) throw new Error(uploadError.message);

    const { error: sourceError } = await supabase
      .from("sources")
      .update({ preview_storage_path: previewPath })
      .eq("id", job.source_id);
    if (sourceError) throw new Error(sourceError.message);

    await updateJob(supabase, job.id, {
      status: "ready",
      phase: "ready",
      progress: 100,
      heartbeat_at: new Date().toISOString(),
      error: null,
    });
  } finally {
    await downloaded.cleanup();
    await rm(scratch, { recursive: true, force: true }).catch(() => undefined);
  }
}
