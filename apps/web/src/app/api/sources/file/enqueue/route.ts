import { NextResponse } from "next/server";
import { MAX_PDF_BYTES } from "@deephaus/shared";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { parseGenerationOptionsFromJson } from "@/lib/jobs/source-with-generation";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  project_id: z.string().uuid(),
  storage_path: z.string().min(1),
  filename: z.string().min(1).max(500),
  file_size: z.number().int().positive().max(MAX_PDF_BYTES),
  mime_type: z.string().optional(),
  extract_images: z.boolean().optional(),
  generate: z.boolean().optional(),
  settings: z.record(z.unknown()).optional(),
  chunk_indices: z.array(z.number().int().min(0)).optional(),
});

function enabled(): boolean {
  const configured =
    process.env.PDF_EXTRACTION_V2 ??
    process.env.NEXT_PUBLIC_PDF_EXTRACTION_V2;
  return configured !== "false";
}

export async function POST(request: Request) {
  if (!enabled()) {
    return NextResponse.json({ error: "Hybrid PDF extraction is not enabled." }, { status: 404 });
  }
  const { user, response } = await requireUser();
  if (response) return response;

  try {
    const body = bodySchema.parse(await request.json());
    const expectedPrefix = `${user!.id}/${body.project_id}/`;
    if (!body.storage_path.startsWith(expectedPrefix) || body.storage_path.includes("..")) {
      return NextResponse.json({ error: "Invalid storage path." }, { status: 400 });
    }
    if (
      body.mime_type &&
      body.mime_type !== "application/pdf" &&
      !body.filename.toLowerCase().endsWith(".pdf")
    ) {
      return NextResponse.json({ error: "Only PDF files can use this endpoint." }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: project } = await supabase
      .from("projects")
      .select("id")
      .eq("id", body.project_id)
      .eq("user_id", user!.id)
      .single();
    if (!project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    const pathParts = body.storage_path.split("/");
    const objectName = pathParts.pop()!;
    const folder = pathParts.join("/");
    const { data: objects, error: objectError } = await supabase.storage
      .from("pdfs")
      .list(folder, { search: objectName, limit: 10 });
    if (objectError || !objects?.some((item) => item.name === objectName)) {
      return NextResponse.json({ error: "Uploaded PDF was not found." }, { status: 409 });
    }

    const { data: source, error: sourceError } = await supabase
      .from("sources")
      .insert({
        project_id: body.project_id,
        type: "pdf",
        title: body.filename,
        raw_text: null,
        storage_path: body.storage_path,
        page_count: null,
        extract_images: body.extract_images !== false,
      })
      .select()
      .single();
    if (sourceError || !source) {
      throw new Error(sourceError?.message ?? "Could not create source.");
    }

    const generation = parseGenerationOptionsFromJson(body);
    const { data: extractionJob, error: jobError } = await supabase
      .from("source_extraction_jobs")
      .insert({
        source_id: source.id,
        storage_path: body.storage_path,
        filename: body.filename,
        file_size: body.file_size,
        extract_images: body.extract_images !== false,
        requested_generation: {
          generate: generation.generate,
          settings: generation.options.settings,
          chunkIndices: generation.options.chunkIndices,
        },
      })
      .select()
      .single();
    if (jobError || !extractionJob) {
      await supabase.from("sources").delete().eq("id", source.id);
      throw new Error(jobError?.message ?? "Could not enqueue PDF extraction.");
    }

    return NextResponse.json(
      { source, extraction_job: extractionJob },
      { status: 202 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not enqueue PDF extraction.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
