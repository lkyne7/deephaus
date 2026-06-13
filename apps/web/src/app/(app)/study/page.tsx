import { Suspense } from "react";
import { DecksSectionSkeleton } from "@/components/dashboard/dashboard-skeleton";
import { StudyClientView } from "@/components/study/study-client-view";
import { getAuthUser } from "@/lib/data/server-auth";
import { getCachedStudyDecks } from "@/lib/study/cached-study-decks";

async function StudyDecksSection() {
  const user = await getAuthUser();
  const initialDecks = user ? await getCachedStudyDecks(user.id) : [];

  return <StudyClientView initialDecks={initialDecks} studyEntry />;
}

/** Deck list streams in via Suspense so the shell can paint before deck counts finish. */
export default function StudyPage() {
  return (
    <div style={{ padding: "32px 40px" }}>
      <Suspense fallback={<DecksSectionSkeleton />}>
        <StudyDecksSection />
      </Suspense>
    </div>
  );
}
