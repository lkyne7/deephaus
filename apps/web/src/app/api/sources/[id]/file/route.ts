import { NextResponse } from "next/server";
import type { SourceType } from "@deephaus/shared";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const SOURCE_FILE_BUCKET = "pdfs";
/** Signed URLs are short-lived; the viewer refetches when one expires. */
const SIGNED_URL_TTL_SECONDS = 60 * 60;

type SourceRow = {
  id: string;
  type: SourceType;
  title: string | null;
  storage_path: string | null;
  preview_storage_path: string | null;
};

function isFileBacked(source: SourceRow): boolean {
  return (
    Boolean(source.storage_path) &&
    !/^https?:\/\//i.test(source.storage_path ?? "") &&
    (source.type === "pdf" ||
      source.type === "docx" ||
      source.type === "pptx" ||
      source.type === "video")
  );
}

/**
 * GET /api/sources/:id/file — short-lived signed URL for the original uploaded
 * document (or its PDF preview rendition for Office files).
 *
 * Query params:
 * - variant: "original" (default) | "preview"
 * - download: when "1", the URL forces a download with the source's filename
 */
export const GET = withApiTiming(async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { id } = await params;
  const url = new URL(request.url);
  const variant = url.searchParams.get("variant") === "preview" ? "preview" : "original";
  const download = url.searchParams.get("download") === "1";

  const supabase = await createClient();
  const { data } = await supabase
    .from("sources")
    .select("id, type, title, storage_path, preview_storage_path")
    .eq("id", id)
    .eq("user_id", user!.id)
    .single();

  const source = data as SourceRow | null;
  if (!source) {
    return NextResponse.json({ error: "Source not found" }, { status: 404 });
  }
  if (!isFileBacked(source)) {
    return NextResponse.json(
      { error: "This source has no stored original file." },
      { status: 404 },
    );
  }

  const path = variant === "preview" ? source.preview_storage_path : source.storage_path;
  if (!path) {
    return NextResponse.json(
      { error: variant === "preview" ? "No preview available yet." : "File not found." },
      { status: 404 },
    );
  }

  const filename =
    variant === "preview"
      ? `${(source.title ?? "document").replace(/\.(docx|pptx|doc)$/i, "")}.pdf`
      : source.title ?? path.split("/").pop() ?? "document";

  const { data: signed, error } = await supabase.storage
    .from(SOURCE_FILE_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS, download ? { download: filename } : undefined);
  if (error || !signed?.signedUrl) {
    return NextResponse.json(
      { error: error?.message ?? "Could not create a download link." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    url: signed.signedUrl,
    variant,
    filename,
    sourceType: source.type,
    expiresIn: SIGNED_URL_TTL_SECONDS,
  });
}, "GET /api/sources/[id]/file");
