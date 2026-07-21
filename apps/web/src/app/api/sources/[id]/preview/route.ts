import { NextResponse } from "next/server";
import type { SourceType } from "@deephaus/shared";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type SourceRow = {
  id: string;
  type: SourceType;
  title: string | null;
  storage_path: string | null;
  preview_storage_path: string | null;
};

type PreviewStatus = "ready" | "pending" | "processing" | "failed" | "none";

async function loadOwnedSource(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sourceId: string,
  userId: string,
): Promise<SourceRow | null> {
  const { data } = await supabase
    .from("sources")
    .select("id, type, title, storage_path, preview_storage_path, projects!inner(user_id)")
    .eq("id", sourceId)
    .eq("projects.user_id", userId)
    .single();
  return (data as SourceRow | null) ?? null;
}

function previewSupported(source: SourceRow): boolean {
  return (
    (source.type === "docx" || source.type === "pptx") &&
    Boolean(source.storage_path) &&
    !/^https?:\/\//i.test(source.storage_path ?? "")
  );
}

async function latestPreviewJob(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sourceId: string,
): Promise<{ id: string; status: string; error: string | null } | null> {
  const { data } = await supabase
    .from("source_extraction_jobs")
    .select("id, status, error")
    .eq("source_id", sourceId)
    .eq("kind", "preview")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { id: string; status: string; error: string | null } | null) ?? null;
}

function statusPayload(
  source: SourceRow,
  job: { id: string; status: string; error: string | null } | null,
): { status: PreviewStatus; job_id?: string; error?: string } {
  if (source.preview_storage_path) return { status: "ready" };
  if (!job) return { status: "none" };
  if (job.status === "ready") {
    // Job finished but the source row wasn't updated — treat as still pending
    // so the client retries rather than requesting a missing file.
    return { status: "pending", job_id: job.id };
  }
  if (job.status === "failed") {
    return { status: "failed", job_id: job.id, error: job.error ?? undefined };
  }
  return { status: job.status as PreviewStatus, job_id: job.id };
}

/** GET /api/sources/:id/preview — current PDF-preview conversion status. */
export const GET = withApiTiming(async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { id } = await params;
  const supabase = await createClient();
  const source = await loadOwnedSource(supabase, id, user!.id);
  if (!source) {
    return NextResponse.json({ error: "Source not found" }, { status: 404 });
  }
  if (!previewSupported(source)) {
    return NextResponse.json(
      { error: "Previews are only generated for Word and PowerPoint files." },
      { status: 400 },
    );
  }
  return NextResponse.json(statusPayload(source, await latestPreviewJob(supabase, id)));
}, "GET /api/sources/[id]/preview");

/**
 * POST /api/sources/:id/preview — enqueue a LibreOffice PDF conversion for a
 * DOCX/PPTX original. Idempotent: returns the existing preview or in-flight
 * job when one is already available.
 */
export const POST = withApiTiming(async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { id } = await params;
  const supabase = await createClient();
  const source = await loadOwnedSource(supabase, id, user!.id);
  if (!source) {
    return NextResponse.json({ error: "Source not found" }, { status: 404 });
  }
  if (!previewSupported(source)) {
    return NextResponse.json(
      { error: "Previews are only generated for Word and PowerPoint files." },
      { status: 400 },
    );
  }
  if (source.preview_storage_path) {
    return NextResponse.json({ status: "ready" });
  }

  const existing = await latestPreviewJob(supabase, id);
  if (existing && (existing.status === "pending" || existing.status === "processing")) {
    return NextResponse.json({ status: existing.status, job_id: existing.id }, { status: 202 });
  }

  const { data: job, error } = await supabase
    .from("source_extraction_jobs")
    .insert({
      source_id: source.id,
      kind: "preview",
      storage_path: source.storage_path,
      filename: source.title ?? source.storage_path!.split("/").pop() ?? "document",
      extract_images: false,
    })
    .select("id, status")
    .single();
  if (error || !job) {
    return NextResponse.json(
      { error: error?.message ?? "Could not enqueue the preview conversion." },
      { status: 500 },
    );
  }

  return NextResponse.json({ status: "pending", job_id: job.id }, { status: 202 });
}, "POST /api/sources/[id]/preview");
