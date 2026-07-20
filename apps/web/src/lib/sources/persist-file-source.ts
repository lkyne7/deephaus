import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { extractSourceFromFile } from "@/lib/sources/extract-source";
import { detectSourceType, maxBytesForSourceType, sourceTypeLabel } from "@/lib/sources/file-types";

const SOURCE_FILE_BUCKET = "pdfs";

export type PersistFileSourceInput = {
  supabase: SupabaseClient;
  userId: string;
  projectId: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
  cachedRawText?: string | null;
  cachedPageCount?: number | null;
  extractImages?: boolean;
};

export type PersistFileSourceResult = {
  source: Record<string, unknown>;
  storageWarning: string | null;
};

async function insertSourceRow(
  supabase: SupabaseClient,
  row: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  let { data, error } = await supabase.from("sources").insert(row).select().single();
  if (error?.message?.includes("extract_images")) {
    const { extract_images: _ignored, ...fallbackRow } = row;
    ({ data, error } = await supabase.from("sources").insert(fallbackRow).select().single());
  }
  if (error || !data) throw new Error(error?.message ?? "Could not save source");
  return data;
}

/**
 * Persist an uploaded document or video source. Text extraction and storage
 * upload run in parallel; cached preview text skips re-extraction.
 */
export async function persistFileSource(
  input: PersistFileSourceInput,
): Promise<PersistFileSourceResult> {
  validateFileSourceInput(input);

  const cachedRawText = input.cachedRawText?.trim() || null;
  const storagePath = `${input.userId}/${input.projectId}/${Date.now()}-${input.filename}`;

  const extractPromise = extractSourceFromFile(
    input.buffer,
    input.filename,
    input.mimeType,
    {
      rawText: cachedRawText,
      pageCount: input.cachedPageCount ?? null,
    },
  );

  const uploadPromise = input.supabase.storage
    .from(SOURCE_FILE_BUCKET)
    .upload(storagePath, input.buffer, {
      contentType: input.mimeType || "application/octet-stream",
      upsert: false,
    });

  const [extracted, uploadResult] = await Promise.all([extractPromise, uploadPromise]);
  const uploadError = uploadResult.error;

  const row = {
    project_id: input.projectId,
    type: extracted.sourceType,
    title: input.filename,
    raw_text: extracted.text,
    storage_path: uploadError ? null : storagePath,
    page_count: extracted.pageCount,
    extract_images: input.extractImages !== false,
  };

  const source = await insertSourceRow(input.supabase, row);

  if (uploadError) {
    console.warn("Source storage upload failed (generation will still proceed):", uploadError.message);
  }

  return {
    source,
    storageWarning: uploadError
      ? "Text was extracted, but the original file could not be saved to storage."
      : null,
  };
}

/**
 * Extract text, persist the source, then run storage upload and generation together.
 */
export async function persistFileSourceAndGenerate(
  input: PersistFileSourceAndGenerateInput,
): Promise<PersistFileSourceResult & { job: Record<string, unknown>; cards: unknown[] }> {
  validateFileSourceInput(input);

  const cachedRawText = input.cachedRawText?.trim() || null;
  if (cachedRawText) {
    return persistCachedFileSourceAndGenerate(input);
  }

  const storagePath = `${input.userId}/${input.projectId}/${Date.now()}-${input.filename}`;

  const extractPromise = extractSourceFromFile(
    input.buffer,
    input.filename,
    input.mimeType,
    {
      pageCount: input.cachedPageCount ?? null,
    },
  );

  const uploadPromise = input.supabase.storage
    .from(SOURCE_FILE_BUCKET)
    .upload(storagePath, input.buffer, {
      contentType: input.mimeType || "application/octet-stream",
      upsert: false,
    });

  const extracted = await extractPromise;
  const source = await insertSourceRow(input.supabase, {
    project_id: input.projectId,
    type: extracted.sourceType,
    title: input.filename,
    raw_text: extracted.text,
    storage_path: storagePath,
    page_count: extracted.pageCount,
    extract_images: input.extractImages !== false,
  });

  const [uploadResult, generation] = await Promise.all([
    uploadPromise,
    input.runGeneration(source.id as string),
  ]);

  let storageWarning: string | null = null;
  if (uploadResult.error) {
    await input.supabase.from("sources").update({ storage_path: null }).eq("id", source.id);
    storageWarning =
      "Text was extracted, but the original file could not be saved to storage.";
    console.warn("Source storage upload failed (generation will still proceed):", uploadResult.error.message);
  }

  return {
    source,
    storageWarning,
    job: generation.job,
    cards: generation.cards,
  };
}

export function cachedPageCountFromForm(form: FormData): number | null {
  const value = form.get("page_count") as string | null;
  if (!value?.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function validateFileSourceInput(input: PersistFileSourceInput) {
  const sourceType = detectSourceType(input.filename, input.mimeType);
  if (!sourceType || sourceType === "text") {
    throw new Error(
      "Unsupported file type. Use PDF, Word (.docx), PowerPoint (.pptx), or video.",
    );
  }

  const maxBytes = maxBytesForSourceType(sourceType);
  if (input.buffer.length > maxBytes) {
    throw new Error(
      `${sourceTypeLabel(sourceType)} exceeds ${Math.round(maxBytes / (1024 * 1024))} MB limit.`,
    );
  }

  return sourceType;
}

export type PersistFileSourceAndGenerateInput = PersistFileSourceInput & {
  runGeneration: (sourceId: string) => Promise<{ job: Record<string, unknown>; cards: unknown[] }>;
};

export type PersistStoredFileSourceInput = Omit<PersistFileSourceInput, "buffer"> & {
  storagePath: string;
  buffer: Buffer;
  runGeneration?: (sourceId: string) => Promise<{ job: Record<string, unknown>; cards: unknown[] }>;
};

/**
 * Persist a document that was already uploaded to storage (resumable / TUS).
 * Skips a second storage upload and extracts text from the provided buffer.
 */
export async function persistStoredFileSource(
  input: PersistStoredFileSourceInput,
): Promise<PersistFileSourceResult & { job?: Record<string, unknown>; cards?: unknown[] }> {
  validateFileSourceInput(input);

  const extracted = await extractSourceFromFile(
    input.buffer,
    input.filename,
    input.mimeType,
    {
      rawText: input.cachedRawText?.trim() || null,
      pageCount: input.cachedPageCount ?? null,
    },
  );

  const source = await insertSourceRow(input.supabase, {
    project_id: input.projectId,
    type: extracted.sourceType,
    title: input.filename,
    raw_text: extracted.text,
    storage_path: input.storagePath,
    page_count: extracted.pageCount,
    extract_images: input.extractImages !== false,
  });

  if (!input.runGeneration) {
    return { source, storageWarning: null };
  }

  const generation = await input.runGeneration(source.id as string);
  return {
    source,
    storageWarning: null,
    job: generation.job,
    cards: generation.cards,
  };
}

/**
 * Save a source from preview text and run storage upload + generation together.
 * Skips re-extraction when cached text is present.
 */
export async function persistCachedFileSourceAndGenerate(
  input: PersistFileSourceAndGenerateInput,
): Promise<PersistFileSourceResult & { job: Record<string, unknown>; cards: unknown[] }> {
  const cachedRawText = input.cachedRawText?.trim();
  if (!cachedRawText) {
    throw new Error("Cached source text is required.");
  }

  const sourceType = validateFileSourceInput(input);
  const storagePath = `${input.userId}/${input.projectId}/${Date.now()}-${input.filename}`;

  const source = await insertSourceRow(input.supabase, {
    project_id: input.projectId,
    type: sourceType,
    title: input.filename,
    raw_text: cachedRawText,
    storage_path: storagePath,
    page_count: input.cachedPageCount ?? null,
    extract_images: input.extractImages !== false,
  });

  const [uploadResult, generation] = await Promise.all([
    input.supabase.storage.from(SOURCE_FILE_BUCKET).upload(storagePath, input.buffer, {
      contentType: input.mimeType || "application/octet-stream",
      upsert: false,
    }),
    input.runGeneration(source.id as string),
  ]);

  let storageWarning: string | null = null;
  if (uploadResult.error) {
    await input.supabase.from("sources").update({ storage_path: null }).eq("id", source.id);
    storageWarning =
      "Text was extracted, but the original file could not be saved to storage.";
    console.warn("Source storage upload failed (generation will still proceed):", uploadResult.error.message);
  }

  return {
    source,
    storageWarning,
    job: generation.job,
    cards: generation.cards,
  };
}
