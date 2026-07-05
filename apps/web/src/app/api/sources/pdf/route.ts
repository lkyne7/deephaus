import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { MAX_PDF_BYTES } from "@deephaus/shared";
import { requireUser } from "@/lib/auth";
import {
  GenerationCapacityError,
  parseGenerationOptionsFromForm,
  runSourceGeneration,
} from "@/lib/jobs/source-with-generation";
import { persistFileSource, persistFileSourceAndGenerate } from "@/lib/sources/persist-file-source";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export const POST = withApiTiming(async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError(
      `Could not read the upload. If your PDF is large, try a smaller file (under ${MAX_PDF_BYTES / (1024 * 1024)} MB).`,
      400,
    );
  }

  const projectId = form.get("project_id") as string;
  const file = form.get("file") as File | null;
  const { generate, options: generationOptions } = parseGenerationOptionsFromForm(form);

  if (!projectId || !file) {
    return jsonError("project_id and file are required", 400);
  }

  if (file.size > MAX_PDF_BYTES) {
    const limitMb = MAX_PDF_BYTES / (1024 * 1024);
    return jsonError(
      `PDF exceeds ${limitMb} MB limit (${(file.size / (1024 * 1024)).toFixed(1)} MB uploaded).`,
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

  try {
    if (generate) {
      const result = await persistFileSourceAndGenerate({
        supabase,
        userId: user!.id,
        projectId,
        filename: file.name,
        mimeType: file.type || "application/pdf",
        buffer,
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

    const { source, storageWarning } = await persistFileSource({
      supabase,
      userId: user!.id,
      projectId,
      filename: file.name,
      mimeType: file.type || "application/pdf",
      buffer,
    });

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
    const message = error instanceof Error ? error.message : "PDF extraction failed";
    return jsonError(message, 422);
  }
}, "POST /api/sources/pdf");
