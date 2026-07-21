import { notFound, redirect } from "next/navigation";
import type { SourceType } from "@deephaus/shared";
import { NoteDetailView } from "@/components/notes/note-detail-view";
import { getAuthUser } from "@/lib/data/server-auth";
import { createClient } from "@/lib/supabase/server";
import { sourceTypeLabel } from "@/lib/sources/file-types";

export const dynamic = "force-dynamic";

type NotePageProps = { params: Promise<{ sourceId: string }> };

type SourceRow = {
  id: string;
  type: SourceType;
  title: string | null;
  storage_path: string | null;
  project_id: string;
  projects:
    | { user_id: string; name: string | null; deck_name: string | null }
    | { user_id: string; name: string | null; deck_name: string | null }[];
};

export default async function NoteDetailPage({ params }: NotePageProps) {
  const { sourceId } = await params;

  const user = await getAuthUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data } = await supabase
    .from("sources")
    .select("id, type, title, storage_path, project_id, projects!inner(user_id, name, deck_name)")
    .eq("id", sourceId)
    .eq("projects.user_id", user.id)
    .single();

  const source = data as SourceRow | null;
  if (!source || source.type === "topic") notFound();

  const project = Array.isArray(source.projects) ? source.projects[0] : source.projects;
  const deckName = project?.deck_name ?? project?.name ?? "Untitled deck";
  const hasOriginalFile =
    Boolean(source.storage_path) &&
    !/^https?:\/\//i.test(source.storage_path ?? "") &&
    (source.type === "pdf" ||
      source.type === "docx" ||
      source.type === "pptx" ||
      source.type === "video");

  return (
    <NoteDetailView
      sourceId={source.id}
      sourceType={source.type}
      title={source.title?.trim() || `${deckName} · ${sourceTypeLabel(source.type)}`}
      deckId={source.project_id}
      deckName={deckName}
      notionUrl={source.type === "notion" ? source.storage_path : null}
      hasOriginalFile={hasOriginalFile}
    />
  );
}
