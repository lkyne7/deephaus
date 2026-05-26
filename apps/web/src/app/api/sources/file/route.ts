import { NextResponse } from "next/server";
import { MAX_SOURCE_FILE_BYTES } from "@deephaus/shared";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { extractSourceFromFile } from "@/lib/sources/extract-source";
import { detectSourceType, maxBytesForSourceType, sourceTypeLabel } from "@/lib/sources/file-types";
import { createClient } from "@/lib/supabase/server";

const MAX_UPLOAD_MB = MAX_SOURCE_FILE_BYTES / (1024 * 1024);

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

  const maxBytes = maxBytesForSourceType(sourceType);
  if (file.size > maxBytes) {
    return jsonError(
      `${sourceTypeLabel(sourceType)} exceeds ${Math.round(maxBytes / (1024 * 1024))} MB limit.`,
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
  let extracted;
  try {
    extracted = await extractSourceFromFile(buffer, file.name, file.type, {
      rawText: cachedRawText,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "File extraction failed";
    return jsonError(message, 422);
  }

  const storagePath = `${user!.id}/${projectId}/${Date.now()}-${file.name}`;
  const { error: uploadError } = await supabase.storage
    .from("pdfs")
    .upload(storagePath, buffer, { contentType: file.type || "application/octet-stream", upsert: false });

  const { data, error } = await supabase
    .from("sources")
    .insert({
      project_id: projectId,
      type: extracted.sourceType,
      raw_text: extracted.text,
      storage_path: uploadError ? null : storagePath,
      page_count: extracted.pageCount,
    })
    .select()
    .single();

  if (error) return jsonError(error.message, 500);

  if (uploadError) {
    console.warn("Source storage upload failed (generation will still proceed):", uploadError.message);
  }

  return NextResponse.json(
    {
      ...data,
      storage_warning: uploadError
        ? "Text was extracted, but the original file could not be saved to storage."
        : null,
    },
    { status: 201 },
  );
}, "POST /api/sources/file");
