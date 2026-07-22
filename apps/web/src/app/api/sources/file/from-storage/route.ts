import { NextResponse } from "next/server";
import { z } from "zod";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import {
  aiCreditsExhaustedResponse,
  creditIdempotencyKey,
  isAiCreditsExhaustedError,
} from "@/lib/credits/service";
import {
  GenerationCapacityError,
  parseGenerationOptionsFromJson,
  runSourceGeneration,
} from "@/lib/jobs/source-with-generation";
import { persistStoredFileSource } from "@/lib/sources/persist-file-source";
import { detectSourceType } from "@/lib/sources/file-types";
import { enqueueSourcePreviewJob } from "@/lib/sources/preview";
import { createClient } from "@/lib/supabase/server";

const SOURCE_FILE_BUCKET = "pdfs";

const bodySchema = z.object({
  project_id: z.string().uuid(),
  storage_path: z.string().min(1),
  filename: z.string().min(1).max(500),
  mime_type: z.string().optional(),
  extract_images: z.boolean().optional(),
  generate: z.boolean().optional(),
  settings: z.record(z.unknown()).optional(),
  chunk_indices: z.array(z.number().int().min(0)).optional(),
});

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export const maxDuration = 300;

/**
 * Persist a document already uploaded via resumable TUS (bypasses the ~4.5 MB
 * Vercel request-body limit that blocks multipart /api/sources/file uploads).
 */
export const POST = withApiTiming(async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  try {
    const body = bodySchema.parse(await request.json());
    const expectedPrefix = `${user!.id}/${body.project_id}/`;
    if (!body.storage_path.startsWith(expectedPrefix) || body.storage_path.includes("..")) {
      return jsonError("Invalid storage path.", 400);
    }

    const sourceType = detectSourceType(body.filename, body.mime_type ?? "");
    if (!sourceType || sourceType === "text" || sourceType === "video") {
      return jsonError(
        "Unsupported file type. Use PDF, Word (.docx), or PowerPoint (.pptx).",
        400,
      );
    }

    const supabase = await createClient();
    const { data: project } = await supabase
      .from("projects")
      .select("id")
      .eq("id", body.project_id)
      .eq("user_id", user!.id)
      .single();
    if (!project) return jsonError("Project not found", 404);

    const { data: blob, error: downloadError } = await supabase.storage
      .from(SOURCE_FILE_BUCKET)
      .download(body.storage_path);
    if (downloadError || !blob) {
      return jsonError("Uploaded file was not found in storage.", 409);
    }

    const buffer = Buffer.from(await blob.arrayBuffer());
    const generation = parseGenerationOptionsFromJson({
      generate: body.generate,
      settings: body.settings,
      chunk_indices: body.chunk_indices,
    });

    const result = await persistStoredFileSource({
      supabase,
      userId: user!.id,
      projectId: body.project_id,
      filename: body.filename,
      mimeType: body.mime_type || "application/octet-stream",
      buffer,
      storagePath: body.storage_path,
      extractImages: body.extract_images !== false,
      creditIdempotencyKey: creditIdempotencyKey(
        user!.id,
        "video-transcription",
        request.headers.get("idempotency-key"),
      ),
      runGeneration: generation.generate
        ? (sourceId) =>
            runSourceGeneration(supabase, user!.id, sourceId, generation.options)
        : undefined,
    });
    await enqueueSourcePreviewJob(supabase, result.source);

    return NextResponse.json(
      {
        ...result.source,
        job: result.job ?? null,
        cards: result.cards ?? [],
        storage_warning: result.storageWarning,
      },
      { status: generation.generate ? 202 : 201 },
    );
  } catch (error) {
    if (isAiCreditsExhaustedError(error)) {
      return aiCreditsExhaustedResponse(error);
    }
    if (error instanceof GenerationCapacityError) {
      return jsonError(error.message, 429);
    }
    if (error instanceof z.ZodError) {
      return jsonError(error.issues[0]?.message ?? "Invalid request.", 400);
    }
    const message = error instanceof Error ? error.message : "File upload failed";
    const status = /extract|unsupported|too short|too large/i.test(message) ? 422 : 500;
    return jsonError(message, status);
  }
}, "POST /api/sources/file/from-storage");
