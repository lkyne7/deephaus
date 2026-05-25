import { notFound, redirect } from "next/navigation";
import { StudyMode, type StudyCard } from "@/components/study-mode";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function StudyPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, deck_name, name")
    .eq("id", id)
    .single();

  if (!project) notFound();

  const { data: cards } = await supabase
    .from("cards")
    .select("*, generation_jobs!inner(source_id, sources!inner(project_id))")
    .eq("generation_jobs.sources.project_id", id)
    .order("sort_order", { ascending: true });

  if (!cards || cards.length === 0) {
    redirect(`/decks/${id}`);
  }

  const typed: StudyCard[] = cards.map((c) => ({
    id: c.id,
    type: c.type,
    front: c.front,
    back: c.back,
    cloze_text: c.cloze_text,
    extra: c.extra,
  }));

  return (
    <StudyMode deckId={id} deckTitle={project.deck_name || project.name} cards={typed} />
  );
}
