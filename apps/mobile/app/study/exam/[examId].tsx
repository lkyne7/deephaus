import { useLocalSearchParams } from "expo-router";
import { SessionGuard } from "@/components/session-guard";
import { StudySession } from "@/components/study/study-session";

/** Studies one exam's ready cards. */
export default function ExamSessionRoute() {
  const { examId } = useLocalSearchParams<{ examId: string }>();
  return (
    <SessionGuard>
      <StudySession kind="exam" id={examId} />
    </SessionGuard>
  );
}
