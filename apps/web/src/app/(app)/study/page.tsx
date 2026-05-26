import { redirect } from "next/navigation";
import { StudyHubView } from "@/components/study-hub-view";
import { createClient } from "@/lib/supabase/server";
import { getStudyDeckOptions, pickDefaultStudyDeckId } from "@/lib/study/decks";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<{ deck?: string }>;
};

export default async function StudyHubPage({ searchParams }: Props) {
  const { deck: deckParam } = await searchParams;
  const supabase = await createClient();
  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes.user;

  if (!user) {
    return <div style={{ padding: 40 }}>Please sign in.</div>;
  }

  let decks;
  try {
    decks = await getStudyDeckOptions(supabase, user.id);
  } catch (err) {
    console.error("[study hub]", err);
    return (
      <div style={{ padding: 40, color: "var(--ink-700)" }}>
        Could not load study decks. Please refresh the page.
      </div>
    );
  }

  if (deckParam === "pick") {
    return (
      <div style={{ padding: "32px 40px" }}>
        <StudyHubView decks={decks} />
      </div>
    );
  }

  const targetId =
    deckParam && decks.some((d) => d.id === deckParam)
      ? deckParam
      : pickDefaultStudyDeckId(decks);

  if (targetId && decks.some((d) => d.id === targetId && d.waiting > 0)) {
    redirect(`/decks/${targetId}/study`);
  }

  return (
    <div style={{ padding: "32px 40px" }}>
      <StudyHubView decks={decks} />
    </div>
  );
}
