import { NextResponse } from "next/server";
import type { SourceType } from "@deephaus/shared";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type SourceRow = {
  id: string;
  type: SourceType;
  title: string | null;
  page_count: number | null;
  storage_path: string | null;
  external_url: string | null;
  preview_storage_path: string | null;
  content_edited_at: string | null;
  created_at: string;
};

export type DeckSourceListItem = {
  id: string;
  type: SourceType;
  title: string;
  pageCount: number | null;
  hasStorage: boolean;
  hasPreview: boolean;
  /** External URL for youtube/notion sources (storage_path is a link there). */
  externalUrl: string | null;
  contentEditedAt: string | null;
  createdAt: string;
};

function defaultTitle(type: SourceType): string {
  switch (type) {
    case "text":
      return "Pasted text";
    case "youtube":
      return "YouTube transcript";
    case "notion":
      return "Notion page";
    case "video":
      return "Video transcript";
    case "xlsx":
      return "Spreadsheet";
    case "website":
      return "Website";
    default:
      return "Document";
  }
}

/**
 * GET /api/projects/:id/sources — every source attached to a deck, newest
 * first, for the NotebookLM-style sources rail. Topic and Anki-import sources
 * carry no viewable material, so they're excluded.
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

  const { data, error } = await supabase
    .from("sources")
    .select(
      "id, type, title, page_count, storage_path, external_url, preview_storage_path, content_edited_at, created_at",
    )
    .eq("project_id", id)
    .not("type", "in", "(topic,apkg)")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const legacyExternal = (row: SourceRow) => row.type === "youtube" || row.type === "notion";
  const sources: DeckSourceListItem[] = ((data ?? []) as SourceRow[]).map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title?.trim() || defaultTitle(row.type),
    pageCount: row.page_count,
    hasStorage: Boolean(row.storage_path) && !legacyExternal(row),
    hasPreview: Boolean(row.preview_storage_path),
    externalUrl: row.external_url ?? (legacyExternal(row) ? row.storage_path : null),
    contentEditedAt: row.content_edited_at,
    createdAt: row.created_at,
  }));

  return NextResponse.json({ sources });
}, "GET /api/projects/[id]/sources");
