import { NextResponse } from "next/server";
import { z } from "zod";
import {
  MAX_SOURCE_FILE_BYTES,
  generationSettingsPartialSchema,
} from "@deephaus/shared";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import {
  GoogleDriveAuthError,
  GoogleDriveNotConnectedError,
  googleDriveFetch,
} from "@/lib/google-drive/client";
import {
  GenerationCapacityError,
  parseGenerationOptionsFromJson,
  runSourceGeneration,
} from "@/lib/jobs/source-with-generation";
import {
  persistFileSource,
  persistFileSourceAndGenerate,
} from "@/lib/sources/persist-file-source";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300;

const bodySchema = z
  .object({
    project_id: z.string().uuid(),
    file_id: z.string().regex(/^[A-Za-z0-9_-]+$/).max(200),
    generate: z.boolean().optional(),
    settings: generationSettingsPartialSchema.optional(),
    chunk_indices: z.array(z.number().int().min(0)).optional(),
  })
  .passthrough();

const GOOGLE_DOC = "application/vnd.google-apps.document";
const GOOGLE_SLIDES = "application/vnd.google-apps.presentation";
const GOOGLE_SHEETS = "application/vnd.google-apps.spreadsheet";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const PDF = "application/pdf";

const nativeExports: Record<string, { mimeType: string; extension: string }> = {
  [GOOGLE_DOC]: { mimeType: DOCX, extension: ".docx" },
  [GOOGLE_SLIDES]: { mimeType: PPTX, extension: ".pptx" },
  [GOOGLE_SHEETS]: { mimeType: XLSX, extension: ".xlsx" },
};

const binaryTypes = new Map([
  [PDF, ".pdf"],
  [DOCX, ".docx"],
  [PPTX, ".pptx"],
  [XLSX, ".xlsx"],
]);

type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  webViewLink?: string;
  trashed?: boolean;
};

function safeFilename(name: string, extension: string): string {
  const base = name
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180) || "Google Drive file";
  return base.toLowerCase().endsWith(extension) ? base : `${base}${extension}`;
}

async function readBoundedDriveResponse(response: Response): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_SOURCE_FILE_BYTES) {
    throw new Error("Drive file is too large to import (max 100 MB).");
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_SOURCE_FILE_BYTES) {
      await reader.cancel();
      throw new Error("Drive file is too large to import (max 100 MB).");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

async function loadDriveFile(
  userId: string,
  fileId: string,
): Promise<{ metadata: DriveFile; bytes: Buffer; filename: string; mimeType: string }> {
  const metadataRes = await googleDriveFetch(
    userId,
    `/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,webViewLink,trashed&supportsAllDrives=true`,
  );
  const metadata = (await metadataRes.json().catch(() => null)) as DriveFile | null;
  if (!metadataRes.ok || !metadata?.id || metadata.trashed) {
    throw new Error(
      metadataRes.status === 404
        ? "That Drive file is no longer available."
        : "Could not read the selected Drive file.",
    );
  }

  const native = nativeExports[metadata.mimeType];
  const binaryExtension = binaryTypes.get(metadata.mimeType);
  if (!native && !binaryExtension) {
    throw new Error("That Drive file type is not supported.");
  }

  const mimeType = native?.mimeType ?? metadata.mimeType;
  const extension = native?.extension ?? binaryExtension!;
  const path = native
    ? `/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(mimeType)}`
    : `/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
  const contentRes = await googleDriveFetch(userId, path);
  if (!contentRes.ok) {
    const detail = await contentRes.text().catch(() => "");
    if (contentRes.status === 403 && /exportSizeLimitExceeded/i.test(detail)) {
      throw new Error("That Google Workspace file is too large to export (Google limits exports to 10 MB).");
    }
    throw new Error(`Could not download the Drive file (HTTP ${contentRes.status}).`);
  }

  const bytes = await readBoundedDriveResponse(contentRes);
  if (bytes.length === 0) throw new Error("Google Drive returned an empty file.");
  return {
    metadata,
    bytes,
    filename: safeFilename(metadata.name, extension),
    mimeType,
  };
}

async function enqueuePdf(
  input: {
    supabase: Awaited<ReturnType<typeof createClient>>;
    userId: string;
    projectId: string;
    filename: string;
    bytes: Buffer;
    externalUrl: string | null;
    generation: ReturnType<typeof parseGenerationOptionsFromJson>;
  },
) {
  const storagePath = `${input.userId}/${input.projectId}/${Date.now()}-${input.filename}`;
  const { error: uploadError } = await input.supabase.storage
    .from("pdfs")
    .upload(storagePath, input.bytes, {
      contentType: PDF,
      upsert: false,
    });
  if (uploadError) throw new Error(`Could not store Drive PDF: ${uploadError.message}`);

  const { data: source, error: sourceError } = await input.supabase
    .from("sources")
    .insert({
      project_id: input.projectId,
      type: "pdf",
      title: input.filename,
      raw_text: null,
      storage_path: storagePath,
      external_url: input.externalUrl,
      page_count: null,
      extract_images: true,
    })
    .select()
    .single();
  if (sourceError || !source) {
    await input.supabase.storage.from("pdfs").remove([storagePath]);
    throw new Error(sourceError?.message ?? "Could not save Drive PDF.");
  }

  const { data: extractionJob, error: jobError } = await input.supabase
    .from("source_extraction_jobs")
    .insert({
      source_id: source.id,
      storage_path: storagePath,
      filename: input.filename,
      file_size: input.bytes.length,
      extract_images: true,
      requested_generation: {
        generate: input.generation.generate,
        settings: input.generation.options.settings,
        chunkIndices: input.generation.options.chunkIndices,
      },
    })
    .select()
    .single();
  if (jobError || !extractionJob) {
    await input.supabase.from("sources").delete().eq("id", source.id);
    await input.supabase.storage.from("pdfs").remove([storagePath]);
    throw new Error(jobError?.message ?? "Could not enqueue Drive PDF extraction.");
  }
  return { source, extraction_job: extractionJob };
}

/** Import one Picker-selected Drive file as a normal DeepHaus source. */
export const POST = withApiTiming(async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch (error) {
    const message = error instanceof z.ZodError ? error.errors[0]?.message : "Invalid request body";
    return NextResponse.json({ error: message ?? "Invalid request body" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", body.project_id)
    .eq("user_id", user!.id)
    .single();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  try {
    const loaded = await loadDriveFile(user!.id, body.file_id);
    const generation = parseGenerationOptionsFromJson(body);
    const externalUrl =
      loaded.metadata.webViewLink ??
      `https://drive.google.com/open?id=${encodeURIComponent(loaded.metadata.id)}`;

    if (loaded.mimeType === PDF) {
      const queued = await enqueuePdf({
        supabase,
        userId: user!.id,
        projectId: body.project_id,
        filename: loaded.filename,
        bytes: loaded.bytes,
        externalUrl,
        generation,
      });
      return NextResponse.json(queued, { status: 202 });
    }

    const persistInput = {
      supabase,
      userId: user!.id,
      projectId: body.project_id,
      filename: loaded.filename,
      mimeType: loaded.mimeType,
      buffer: loaded.bytes,
      externalUrl,
      extractImages: true,
    };
    const result = generation.generate
      ? await persistFileSourceAndGenerate({
          ...persistInput,
          runGeneration: (sourceId) =>
            runSourceGeneration(supabase, user!.id, sourceId, generation.options),
        })
      : await persistFileSource(persistInput);
    const generated =
      "job" in result
        ? (result as typeof result & { job: Record<string, unknown>; cards: unknown[] })
        : null;
    return NextResponse.json(
      {
        ...result.source,
        ...(generated ? { job: generated.job, cards: generated.cards } : {}),
        storage_warning: result.storageWarning,
      },
      { status: 201 },
    );
  } catch (error) {
    if (
      error instanceof GoogleDriveNotConnectedError ||
      error instanceof GoogleDriveAuthError
    ) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof GenerationCapacityError) {
      return NextResponse.json({ error: error.message }, { status: 429 });
    }
    const message = error instanceof Error ? error.message : "Could not import Drive file.";
    const status = /not supported|too large|empty|extract|readable/i.test(message) ? 422 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}, "POST /api/sources/google-drive");
