import { NextResponse } from "next/server";
import { sourceDocToPlainText } from "@deephaus/rich-text";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { requirePlan } from "@/lib/billing/access";
import { createClient } from "@/lib/supabase/server";
import { notionErrorResponse } from "@/lib/notion/api-errors";
import { importNotionPageDoc } from "@/lib/notion/blocks-to-doc";
import { notionPageIdFromUrl } from "@/lib/notion/pages";

export const maxDuration = 120;

/**
 * POST /api/sources/:id/notion-sync — re-import a Notion source from Notion,
 * replacing local document edits. Chunks are invalidated like a document PUT.
 */
export const POST = withApiTiming(async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, response } = await requireUser();
  if (response) return response;
  const planResponse = await requirePlan(
    user!.id,
    "plus",
    "Notion synchronization",
  );
  if (planResponse) return planResponse;

  const { id } = await params;
  const supabase = await createClient();

  const { data: source } = await supabase
    .from("sources")
    .select("id, type, storage_path, projects!inner(user_id)")
    .eq("id", id)
    .eq("projects.user_id", user!.id)
    .single();
  if (!source) {
    return NextResponse.json({ error: "Source not found" }, { status: 404 });
  }
  if (source.type !== "notion") {
    return NextResponse.json({ error: "Only Notion sources can be re-synced." }, { status: 400 });
  }

  const pageId = notionPageIdFromUrl(source.storage_path);
  if (!pageId) {
    return NextResponse.json(
      { error: "This source is missing its Notion page reference." },
      { status: 422 },
    );
  }

  try {
    const { doc, page } = await importNotionPageDoc({
      userId: user!.id,
      pageId,
      supabase,
      sourceId: source.id,
    });

    const rawText = sourceDocToPlainText(doc);
    const editedAt = new Date().toISOString();

    const { error } = await supabase
      .from("sources")
      .update({
        title: page.title,
        raw_text: rawText,
        storage_path: page.url ?? source.storage_path,
        edited_content: doc,
        content_edited_at: editedAt,
      })
      .eq("id", source.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Drop cached chunks/embeddings so the next generation uses fresh content.
    await supabase.from("source_chunks").delete().eq("source_id", source.id);

    return NextResponse.json({ ok: true, contentEditedAt: editedAt, title: page.title });
  } catch (error) {
    const mapped = notionErrorResponse(error);
    if (mapped) return mapped;
    const message = error instanceof Error ? error.message : "Could not re-sync from Notion.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}, "POST /api/sources/[id]/notion-sync");
