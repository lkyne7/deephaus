import { NextResponse } from "next/server";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { MAX_PDF_BYTES } from "@deephaus/shared";
import { requireUser } from "@/lib/auth";
import { extractPdfText } from "@/lib/pdf/extract";
import { createClient } from "@/lib/supabase/server";

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
      "Could not read the upload. If your PDF is large, try a smaller file (under 25 MB).",
      400,
    );
  }

  const projectId = form.get("project_id") as string;
  const file = form.get("file") as File | null;

  if (!projectId || !file) {
    return jsonError("project_id and file are required", 400);
  }

  if (file.size > MAX_PDF_BYTES) {
    return jsonError(
      `PDF exceeds 25 MB limit (${(file.size / (1024 * 1024)).toFixed(1)} MB uploaded).`,
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
    extracted = await extractPdfText(buffer);
  } catch (error) {
    const message = error instanceof Error ? error.message : "PDF extraction failed";
    return jsonError(message, 422);
  }

  const storagePath = `${user!.id}/${projectId}/${Date.now()}-${file.name}`;
  const { error: uploadError } = await supabase.storage
    .from("pdfs")
    .upload(storagePath, buffer, { contentType: "application/pdf", upsert: false });

  const { data, error } = await supabase
    .from("sources")
    .insert({
      project_id: projectId,
      type: "pdf",
      raw_text: extracted.text,
      storage_path: uploadError ? null : storagePath,
      page_count: extracted.pageCount,
    })
    .select()
    .single();

  if (error) return jsonError(error.message, 500);

  if (uploadError) {
    console.warn("PDF storage upload failed (generation will still proceed):", uploadError.message);
  }

  return NextResponse.json(
    {
      ...data,
      storage_warning: uploadError
        ? "PDF text was extracted, but the file could not be saved to storage."
        : null,
    },
    { status: 201 },
  );
}, "POST /api/sources/pdf");
