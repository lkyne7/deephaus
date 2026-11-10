import { useLocalSearchParams } from "expo-router";
import { SessionGuard } from "@/components/session-guard";
import { StudySession } from "@/components/study/study-session";

/** Studies one deck. */
export default function StudySessionRoute() {
  const { deckId } = useLocalSearchParams<{ deckId: string }>();
  return (
    <SessionGuard>
      <StudySession kind="deck" id={deckId} />
    </SessionGuard>
  );
}
