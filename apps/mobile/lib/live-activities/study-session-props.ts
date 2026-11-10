/**
 * Pure helpers for the study-session Live Activity. Kept free of Expo imports so
 * they can be unit tested; the layout itself lives in study-session-activity.tsx.
 */

export type StudySessionActivityProps = {
  /** Deck or exam name. */
  title: string;
  /** "Review session", "Exam · 84% now", or "Cram · 84% now" on the exam's last day. */
  subtitle: string;
  done: number;
  remaining: number;
  again: number;
  hard: number;
  good: number;
  easy: number;
  /** Epoch milliseconds; the Lock Screen timer counts up from here. */
  startedAt: number;
  status: "active" | "complete";
  /** Final line for the complete state, e.g. "30 cards in 09:48". */
  summary: string;
};

export type StudySessionActivityInput = {
  kind: "review" | "exam";
  title: string;
  /** Exam only: predicted recall if the exam were now, 0..1 (`snapshot.recall_now`). */
  recallNow?: number | null;
  /** Exam only: the exam is less than a day away, so the session is worded as a cram. */
  sameDay?: boolean;
  done: number;
  remaining: number;
  grades: { again: number; hard: number; good: number; easy: number };
  startedAt: number;
  status: "active" | "complete";
  /** Only needed for the complete summary. */
  now?: number;
};

export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

export function buildStudySessionActivityProps(
  input: StudySessionActivityInput,
): StudySessionActivityProps {
  const total = input.done + input.remaining;
  const examWord = input.sameDay ? "Cram" : "Exam";
  const subtitle =
    input.kind === "exam"
      ? input.recallNow == null || !Number.isFinite(input.recallNow)
        ? `${examWord} session`
        : `${examWord} · ${Math.round(Math.max(0, Math.min(1, input.recallNow)) * 100)}% now`
      : "Review session";
  const summary =
    input.status === "complete"
      ? `${input.done} card${input.done === 1 ? "" : "s"} in ${formatElapsed(
          (input.now ?? Date.now()) - input.startedAt,
        )}`
      : "";
  return {
    title: input.title.trim() || (input.kind === "exam" ? "Exam session" : "Study session"),
    subtitle,
    done: Math.max(0, input.done),
    remaining: Math.max(0, input.status === "complete" ? 0 : total - input.done),
    again: input.grades.again,
    hard: input.grades.hard,
    good: input.grades.good,
    easy: input.grades.easy,
    startedAt: input.startedAt,
    status: input.status,
    summary,
  };
}
