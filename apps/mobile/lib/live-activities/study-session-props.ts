/**
 * Pure helpers for the study-session Live Activity. Kept free of Expo imports so
 * they can be unit tested; the layout itself lives in study-session-activity.tsx.
 */

export type StudySessionActivityProps = {
  /** Deck or cram plan name. */
  title: string;
  /** "Review session" or "Cram · 72% ready". */
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
  kind: "review" | "cram";
  title: string;
  /** Cram readiness, 0–100. Ignored for deck reviews. */
  readiness?: number | null;
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
  const subtitle =
    input.kind === "cram"
      ? input.readiness == null
        ? "Cram session"
        : `Cram · ${Math.round(input.readiness)}% ready`
      : "Review session";
  const summary =
    input.status === "complete"
      ? `${input.done} card${input.done === 1 ? "" : "s"} in ${formatElapsed(
          (input.now ?? Date.now()) - input.startedAt,
        )}`
      : "";
  return {
    title: input.title.trim() || (input.kind === "cram" ? "Cram session" : "Study session"),
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
