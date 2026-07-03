import { NextResponse } from "next/server";
import type { JSONContent } from "@tiptap/core";
import type { SourceType } from "@deephaus/shared";
import { sourceDocToPlainText } from "@deephaus/rich-text";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { buildSourceDocument } from "@/lib/sources/source-document";

export const maxDuration = 60;

type SourceRow = {
  id: string;
  type: SourceType;
  raw_text: string | null;
  storage_path: string | null;
  extract_images?: boolean | null;
  edited_content: JSONContent | null;
  content_edited_at: string | null;
};

async function loadOwnedSource(
  supabase: Awaited<ReturnType<typeof createClient>>,
  sourceId: string,
  userId: string,
): Promise<SourceRow | null> {
  const { data } = await supabase
    .from("sources")
    .select("*, projects!inner(user_id)")
    .eq("id", sourceId)
    .eq("projects.user_id", userId)
    .single();
  return (data as SourceRow | null) ?? null;
}

/**
 * GET /api/sources/:id/document — the editable extracted document. Seeded lazily
 * from the original file (DOCX/PPTX images) or extracted text the first time.
 */
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

  if (source.edited_content) {
    return NextResponse.json({
      content: source.edited_content,
      sourceType: source.type,
      contentEditedAt: source.content_edited_at,
      seeded: false,
    });
  }

  const { content, rawText } = await buildSourceDocument(supabase, user!.id, {
    id: source.id,
    type: source.type,
    raw_text: source.raw_text,
    storage_path: source.storage_path,
    extract_images: source.extract_images,
  });

  const editedAt = new Date().toISOString();
  const update: Record<string, unknown> = {
    edited_content: content,
    content_edited_at: editedAt,
  };
  // Self-heal: restore raw_text if it was missing and we re-extracted it, so
  // generation and "View source" keep working.
  if (!(source.raw_text ?? "").trim() && rawText) {
    update.raw_text = rawText;
  }
  await supabase.from("sources").update(update).eq("id", source.id);

  return NextResponse.json({
    content,
    sourceType: source.type,
    contentEditedAt: editedAt,
    seeded: true,
  });
}, "GET /api/sources/[id]/document");

/**
 * PUT /api/sources/:id/document — persist edits. The derived plain text is
 * written back to raw_text so generation uses the edited content, and the
 * source's chunk/embedding cache is invalidated so it rebuilds on next generate.
 */
export const PUT = withApiTiming(async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { id } = await params;

  let body: { content?: unknown };
  try {
    body = (await request.json()) as { content?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const content = body.content as JSONContent | undefined;
  if (!content || typeof content !== "object" || (content as JSONContent).type !== "doc") {
    return NextResponse.json({ error: "A ProseMirror doc is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const source = await loadOwnedSource(supabase, id, user!.id);
  if (!source) {
    return NextResponse.json({ error: "Source not found" }, { status: 404 });
  }

  const plainText = sourceDocToPlainText(content);
  const editedAt = new Date().toISOString();

  const { error } = await supabase
    .from("sources")
    .update({
      edited_content: content,
      raw_text: plainText,
      content_edited_at: editedAt,
    })
    .eq("id", source.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Drop cached chunks/embeddings so the next generation re-derives from edits.
  await supabase.from("source_chunks").delete().eq("source_id", source.id);

  return NextResponse.json({ ok: true, contentEditedAt: editedAt });
}, "PUT /api/sources/[id]/document");
