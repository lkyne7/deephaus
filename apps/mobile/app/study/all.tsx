import { SessionGuard } from "@/components/session-guard";
import { StudySession } from "@/components/study/study-session";

/** Home's Study button: every exam with cards ready, then every deck with work today. */
export default function CombinedStudySessionRoute() {
  return (
    <SessionGuard>
      <StudySession kind="all" />
    </SessionGuard>
  );
}
