import { notFound, redirect } from "next/navigation";
import { DeckSubscriptionSync } from "@/components/deck-subscription-sync";
import { StudyMode } from "@/components/study-mode";
import { getAuthUser } from "@/lib/data/server-auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export default async function StudyPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: project }, { data: cardCountRows }, user] = await Promise.all([
    supabase.from("projects").select("id, deck_name, name").eq("id", id).single(),
    supabase.rpc("count_cards_by_projects", { p_project_ids: [id] }),
    getAuthUser(),
  ]);

  if (!project) notFound();

  const cardCount = Number(
    ((cardCountRows ?? []) as Array<{ card_count: number }>)[0]?.card_count ?? 0,
  );

  if (!cardCount) {
    redirect(`/decks/${id}`);
  }

  return (
    <>
      {user ? <DeckSubscriptionSync deckId={id} /> : null}
      <StudyMode deckId={id} deckTitle={project.deck_name || project.name} />
    </>
  );
}
