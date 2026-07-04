import { NextResponse } from "next/server";
import type { CardSourceLocation, SourceType } from "@deephaus/shared";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { renderSourcePageImage } from "@/lib/sources/segment-thumbnails";

export const maxDuration = 60;

const SOURCE_FILE_BUCKET = "pdfs";

function first<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** Parse the first `--- M:SS ---` / `--- H:MM:SS ---` transcript marker to seconds. */
function firstTimestampSeconds(content: string | null): number | null {
  if (!content) return null;
  const match = content.match(/---\s*(\d+):(\d{2})(?::(\d{2}))?\s*---/);
  if (!match) return null;
  const a = Number(match[1]);
  const b = Number(match[2]);
  const c = match[3] != null ? Number(match[3]) : null;
  return c != null ? a * 3600 + b * 60 + c : a * 60 + b;
}

function youtubeUrlWithTime(url: string | null, seconds: number | null): string | null {
  if (!url) return null;
  if (seconds == null || seconds <= 0) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}t=${seconds}s`;
}

/**
 * GET /api/cards/:id/source — resolve the exact source segment a card was
 * generated from, including a rendered page image for PDF/PowerPoint sources.
 */
export const GET = withApiTiming(async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { id } = await params;
  const supabase = await createClient();

  const { data: card, error } = await supabase
    .from("cards")
    .select(
      "id, source_chunk_id, source_ref, generation_jobs!inner(sources!inner(id, type, storage_path, projects!inner(user_id)))",
    )
    .eq("id", id)
    .eq("generation_jobs.sources.projects.user_id", user!.id)
    .single();

  if (error || !card) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  const job = first(card.generation_jobs as unknown);
  const source = first((job as { sources?: unknown })?.sources) as {
    id: string;
    type: SourceType;
    storage_path: string | null;
  } | null;

  if (!source) {
    return NextResponse.json({ error: "Source not found" }, { status: 404 });
  }

  let chunk: {
    content: string;
    label: string | null;
    source_ref: string;
    page_start: number | null;
    page_end: number | null;
  } | null = null;

  if (card.source_chunk_id) {
    const { data } = await supabase
      .from("source_chunks")
      .select("content, label, source_ref, page_start, page_end")
      .eq("id", card.source_chunk_id)
      .maybeSingle();
    chunk = data ?? null;
  }

  const pageStart = chunk?.page_start ?? null;
  const pageEnd = chunk?.page_end ?? null;

  // Best-effort page render for document sources.
  let pageImageUrl: string | null = null;
  if (
    (source.type === "pdf" || source.type === "pptx") &&
    source.storage_path &&
    pageStart != null
  ) {
    try {
      const { data: blob } = await supabase.storage
        .from(SOURCE_FILE_BUCKET)
        .download(source.storage_path);
      if (blob) {
        const buffer = Buffer.from(await blob.arrayBuffer());
        pageImageUrl = await renderSourcePageImage(buffer, source.type, pageStart);
      }
    } catch (err) {
      console.warn("[cards/source] page render failed:", err);
    }
  }

  const externalUrl =
    source.type === "youtube"
      ? youtubeUrlWithTime(source.storage_path, firstTimestampSeconds(chunk?.content ?? null))
      : source.type === "notion"
        ? source.storage_path
        : null;

  const payload: CardSourceLocation = {
    sourceId: source.id,
    sourceType: source.type,
    sourceRef: chunk?.source_ref ?? card.source_ref ?? null,
    label: chunk?.label ?? card.source_ref ?? null,
    content: chunk?.content ?? null,
    pageStart,
    pageEnd,
    pageImageUrl,
    externalUrl,
  };

  return NextResponse.json(payload);
}, "GET /api/cards/[id]/source");
