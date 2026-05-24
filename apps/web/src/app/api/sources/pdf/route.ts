import { NextResponse } from "next/server";
import { MAX_PDF_BYTES } from "@sluggo/shared";
import { requireUser } from "@/lib/auth";
import { extractPdfText } from "@/lib/pdf/extract";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const { user, response } = await requireUser();
  if (response) return response;

  const form = await request.formData();
  const projectId = form.get("project_id") as string;
  const file = form.get("file") as File | null;

  if (!projectId || !file) {
    return NextResponse.json({ error: "project_id and file are required" }, { status: 400 });
  }

  if (file.size > MAX_PDF_BYTES) {
    return NextResponse.json({ error: "PDF exceeds 25 MB limit" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", user!.id)
    .single();

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let extracted;
  try {
    extracted = await extractPdfText(buffer);
  } catch (error) {
    const message = error instanceof Error ? error.message : "PDF extraction failed";
    return NextResponse.json({ error: message }, { status: 422 });
  }

  const storagePath = `${user!.id}/${projectId}/${Date.now()}-${file.name}`;
  const service = createServiceClient();
  const { error: uploadError } = await service.storage
    .from("pdfs")
    .upload(storagePath, buffer, { contentType: "application/pdf", upsert: false });

  if (uploadError) {
    return NextResponse.json(
      { error: `Storage upload failed: ${uploadError.message}. Ensure the 'pdfs' bucket exists.` },
      { status: 500 },
    );
  }

  const { data, error } = await supabase
    .from("sources")
    .insert({
      project_id: projectId,
      type: "pdf",
      raw_text: extracted.text,
      storage_path: storagePath,
      page_count: extracted.pageCount,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
