import { NextResponse } from "next/server";
import type { SourceType } from "@deephaus/shared";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type SourceRow = {
  id: string;
  type: SourceType;
  page_count: number | null;
  storage_path: string | null;
  edited_content: unknown | null;
  content_edited_at: string | null;
  created_at: string;
};

/**
 * GET /api/projects/:id/source — the deck's most recent source, used by the
 * Create page to show the editable extracted document. Topic decks have no
 * editable source material, so they're reported as null.
 */
export const GET = withApiTiming(async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { user, response } = await requireUser();
  if (response) return response;

  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", id)
    .eq("user_id", user!.id)
    .single();
  if (!project) {
    return NextResponse.json({ error: "Deck not found" }, { status: 404 });
  }

  const { data } = await supabase
    .from("sources")
    .select("id, type, page_count, storage_path, edited_content, content_edited_at, created_at")
    .eq("project_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const source = data as SourceRow | null;
  if (!source || source.type === "topic") {
    return NextResponse.json({ source: null });
  }

  return NextResponse.json({
    source: {
      id: source.id,
      type: source.type,
      pageCount: source.page_count,
      hasStorage: Boolean(source.storage_path),
      hasDocument: source.edited_content != null,
      contentEditedAt: source.content_edited_at,
    },
  });
}, "GET /api/projects/[id]/source");
