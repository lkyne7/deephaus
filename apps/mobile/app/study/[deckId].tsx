import { parseStudyQueueOptions, studyQueueQuery } from "@deephaus/shared";
import { useLocalSearchParams } from "expo-router";
import { SessionGuard } from "@/components/session-guard";
import { StudySession } from "@/components/study/study-session";

/** Studies one deck. The finish page passes options for more than the ordinary day. */
export default function StudySessionRoute() {
  const params = useLocalSearchParams<{ deckId: string } & Record<string, string>>();
  const options = parseStudyQueueOptions((key) => params[key]);
  return (
    <SessionGuard>
      {/* A different deck, or more of the same one, is a new session. */}
      <StudySession
        key={`${params.deckId}:${studyQueueQuery(options)}`}
        kind="deck"
        id={params.deckId}
        options={options}
      />
    </SessionGuard>
  );
}
