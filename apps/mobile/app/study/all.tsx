import { parseStudyQueueOptions, studyQueueQuery } from "@deephaus/shared";
import { useLocalSearchParams } from "expo-router";
import { SessionGuard } from "@/components/session-guard";
import { StudySession } from "@/components/study/study-session";

/**
 * Home's Study button: every exam with cards ready, then every deck with work
 * today. `goal` makes it Home's short session, stopping after that many cards.
 */
export default function CombinedStudySessionRoute() {
  const params = useLocalSearchParams<Record<string, string>>();
  const { goal } = params;
  const options = parseStudyQueueOptions((key) => params[key]);
  const cards = goal ? Number.parseInt(goal, 10) : NaN;
  return (
    <SessionGuard>
      <StudySession
        key={studyQueueQuery(options)}
        kind="all"
        goal={Number.isFinite(cards) ? cards : undefined}
        options={options}
      />
    </SessionGuard>
  );
}
