import { NextResponse } from "next/server";
import { MAX_SOURCE_FILE_BYTES } from "@deephaus/shared";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import {
  GenerationCapacityError,
  parseGenerationOptionsFromForm,
  runSourceGeneration,
} from "@/lib/jobs/source-with-generation";
import {
  cachedPageCountFromForm,
  persistCachedFileSourceAndGenerate,
  persistFileSource,
  persistFileSourceAndGenerate,
} from "@/lib/sources/persist-file-source";
import { detectSourceType } from "@/lib/sources/file-types";
import { createClient } from "@/lib/supabase/server";

const MAX_UPLOAD_MB = MAX_SOURCE_FILE_BYTES / (1024 * 1024);

export const maxDuration = 300;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/** Upload PDF, Word, PowerPoint, or video and persist extracted/transcribed text. */
export const POST = withApiTiming(async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError(`Could not read the upload. Try a smaller file (under ${MAX_UPLOAD_MB} MB).`, 400);
  }

  const projectId = form.get("project_id") as string;
  const file = form.get("file") as File | null;
  const cachedRawText = (form.get("raw_text") as string | null)?.trim() || null;
  const extractImages = form.get("extract_images") !== "false";
  const { generate, options: generationOptions } = parseGenerationOptionsFromForm(form);

  if (!projectId || !file) {
    return jsonError("project_id and file are required", 400);
  }

  const sourceType = detectSourceType(file.name, file.type);
  if (!sourceType || sourceType === "text") {
    return jsonError(
      "Unsupported file type. Use PDF, Word (.docx), PowerPoint (.pptx), or video.",
      400,
    );
  }

  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", user!.id)
    .single();

  if (!project) {
    return jsonError("Project not found", 404);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const persistInput = {
    supabase,
    userId: user!.id,
    projectId,
    filename: file.name,
    mimeType: file.type,
    buffer,
    cachedRawText,
    cachedPageCount: cachedPageCountFromForm(form),
    extractImages,
  };

  try {
    if (generate) {
      const result = await (cachedRawText
        ? persistCachedFileSourceAndGenerate
        : persistFileSourceAndGenerate)({
        ...persistInput,
        runGeneration: (sourceId) =>
          runSourceGeneration(supabase, user!.id, sourceId, generationOptions),
      });

      return NextResponse.json(
        {
          ...result.source,
          job: result.job,
          cards: result.cards,
          storage_warning: result.storageWarning,
        },
        { status: 201 },
      );
    }

    const { source, storageWarning } = await persistFileSource(persistInput);

    return NextResponse.json(
      {
        ...source,
        storage_warning: storageWarning,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof GenerationCapacityError) {
      return jsonError(error.message, 429);
    }
    const message = error instanceof Error ? error.message : "File upload failed";
    const status = /extract|transcri|unsupported|too short|too large/i.test(message) ? 422 : 500;
    return jsonError(message, status);
  }
}, "POST /api/sources/file");
