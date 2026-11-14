import { useLocalSearchParams } from "expo-router";
import { SessionGuard } from "@/components/session-guard";
import { StudySession } from "@/components/study/study-session";

/**
 * Home's Study button: every exam with cards ready, then every deck with work
 * today. `goal` makes it Home's short session, stopping after that many cards.
 */
export default function CombinedStudySessionRoute() {
  const { goal } = useLocalSearchParams<{ goal?: string }>();
  const cards = goal ? Number.parseInt(goal, 10) : NaN;
  return (
    <SessionGuard>
      <StudySession kind="all" goal={Number.isFinite(cards) ? cards : undefined} />
    </SessionGuard>
  );
}
