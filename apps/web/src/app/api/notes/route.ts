import { NextResponse } from "next/server";
import type { SourceType } from "@deephaus/shared";
import { withApiTiming } from "@/lib/perf/with-api-timing";
import { requireUser } from "@/lib/auth";
import { sourceTypeLabel } from "@/lib/sources/file-types";

type SourceRow = {
  id: string;
  type: SourceType;
  title: string | null;
  page_count: number | null;
  storage_path: string | null;
  created_at: string;
  content_edited_at: string | null;
  project_id: string;
  projects: { name: string | null; deck_name: string | null } | { name: string | null; deck_name: string | null }[];
};

type NoteListItem = {
  id: string;
  type: SourceType;
  title: string;
  deckId: string;
  deckName: string;
  createdAt: string;
  updatedAt: string;
};

function projectOf(row: SourceRow): { name: string | null; deck_name: string | null } | null {
  if (Array.isArray(row.projects)) return row.projects[0] ?? null;
  return row.projects ?? null;
}

/**
 * GET /api/notes — every source across the user's decks (the unified notes
 * library). Topic sources carry no material and Anki imports aren't editable
 * documents, so both are excluded.
 */
export const GET = withApiTiming(async function GET() {
  const { user, supabase, response } = await requireUser();
  if (response) return response;

  const { data, error } = await supabase
    .from("sources")
    .select(
      "id, type, title, page_count, storage_path, created_at, content_edited_at, project_id, projects!inner(user_id, name, deck_name)",
    )
    .eq("projects.user_id", user!.id)
    .not("type", "in", "(topic,apkg)")
    .order("created_at", { ascending: false })
    .limit(300);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const notes: NoteListItem[] = ((data ?? []) as unknown as SourceRow[]).map((row) => {
    const project = projectOf(row);
    const deckName = project?.deck_name ?? project?.name ?? "Untitled deck";
    return {
      id: row.id,
      type: row.type,
      title: row.title?.trim() || `${deckName} · ${sourceTypeLabel(row.type)}`,
      deckId: row.project_id,
      deckName,
      createdAt: row.created_at,
      updatedAt: row.content_edited_at ?? row.created_at,
    };
  });

  return NextResponse.json({ notes });
}, "GET /api/notes");
