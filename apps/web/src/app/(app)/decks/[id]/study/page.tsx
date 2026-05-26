import { notFound, redirect } from "next/navigation";
import { StudyMode } from "@/components/study-mode";
import { syncFollowSubscriptionIfNeeded } from "@/lib/community/subscribe";
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

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    await syncFollowSubscriptionIfNeeded(supabase, id, user.id);
  }

  // Make sure the deck has at least one card before sending the user into
  // the study session shell; if not, bounce back to the deck page.
  const { count } = await supabase
    .from("cards")
    .select("id, generation_jobs!inner(sources!inner(project_id))", {
      count: "exact",
      head: true,
    })
    .eq("generation_jobs.sources.project_id", id);

  if (!count) {
    redirect(`/decks/${id}`);
  }

  return <StudyMode deckId={id} deckTitle={project.deck_name || project.name} />;
}
