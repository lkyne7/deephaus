/**
 * Pure helpers for the background-task Live Activity (card generation, Anki import
 * and export). Free of Expo imports so they can be unit tested.
 */

export type TaskActivityKind = "generation" | "anki-import" | "anki-export";

export type TaskActivityProps = {
  kind: TaskActivityKind;
  /** "Generating cards", "Importing Anki deck", "Exporting deck". */
  title: string;
  /** Source and destination, e.g. "From notes.pdf · into Cardiology". */
  detail: string;
  /** Current phase label, e.g. "Extracting content…", or the result when finished. */
  phase: string;
  /** 0–100, quantised so ActivityKit updates stay within budget. */
  progress: number;
  /** Epoch ms when measurable progress began; start of the timer-driven bar. */
  startedAt: number;
  /** Estimated finish in epoch ms, or null while there is no estimate. */
  etaAt: number | null;
  status: "running" | "ready" | "failed";
};

export type TaskActivityInput = {
  kind: TaskActivityKind;
  /** Task title from the banner, e.g. "notes.pdf", "Topic: Krebs cycle", "YouTube import". */
  title: string;
  sourceLabel: string;
  deckName?: string;
  phaseLabel: string;
  progress: number;
  status: "running" | "ready" | "failed";
  createdAt: number;
  progressStartedAt?: number;
  /** Remaining time estimate in ms, or null. */
  etaMs: number | null;
  cardsAdded?: number;
  error?: string | null;
  now?: number;
};

const PROGRESS_STEP = 5;
const ETA_STEP_MS = 15_000;
/** Estimates run short more often than long; let the timer bar lag the estimate a little. */
const ETA_MARGIN = 1.15;

export function quantiseProgress(progress: number): number {
  const clamped = Math.min(100, Math.max(0, progress));
  return Math.round(clamped / PROGRESS_STEP) * PROGRESS_STEP;
}

export function taskActivityTitle(kind: TaskActivityKind, status: TaskActivityInput["status"], input: TaskActivityInput): string {
  if (status === "failed") {
    return kind === "generation"
      ? "Card generation failed"
      : kind === "anki-import"
        ? "Anki import failed"
        : "Export failed";
  }
  if (status === "ready") {
    if (kind === "generation") {
      const count = input.cardsAdded ?? 0;
      return count > 0 ? `${count} card${count === 1 ? "" : "s"} added` : "Cards added";
    }
    return kind === "anki-import" ? "Import complete" : "Export ready";
  }
  return kind === "generation"
    ? "Generating cards"
    : kind === "anki-import"
      ? "Importing Anki deck"
      : "Exporting deck";
}

export function buildTaskActivityProps(input: TaskActivityInput): TaskActivityProps {
  const now = input.now ?? Date.now();
  const title = taskActivityTitle(input.kind, input.status, input);
  let detail: string;
  if (input.kind === "generation") {
    const into = input.deckName ? ` · into ${input.deckName}` : "";
    detail =
      input.status === "ready" && input.deckName
        ? `Added to ${input.deckName} · Tap to view`
        : `From ${input.sourceLabel}${into}`;
  } else if (input.kind === "anki-import") {
    detail = input.status === "ready" ? "Tap to open your decks" : input.title;
  } else {
    detail = input.status === "ready" ? "Tap to share the .apkg file" : input.title;
  }
  const phase =
    input.status === "failed"
      ? input.error?.trim() || "Something went wrong"
      : input.status === "ready"
        ? "Done"
        : input.phaseLabel;
  const startedAt = input.progressStartedAt ?? input.createdAt;
  const etaAt =
    input.status === "running" && input.etaMs != null
      ? Math.round((now + input.etaMs * ETA_MARGIN) / ETA_STEP_MS) * ETA_STEP_MS
      : null;
  return {
    kind: input.kind,
    title,
    detail,
    phase,
    progress: input.status === "ready" ? 100 : quantiseProgress(input.progress),
    startedAt,
    etaAt,
    status: input.status,
  };
}

/**
 * Updates are throttled by ActivityKit, so only push a new state when something the
 * user can see has changed. The estimate is allowed to drift a little before it is resent.
 */
export function taskActivityPropsChanged(previous: TaskActivityProps | null, next: TaskActivityProps): boolean {
  if (!previous) return true;
  if (
    previous.status !== next.status ||
    previous.title !== next.title ||
    previous.detail !== next.detail ||
    previous.phase !== next.phase ||
    previous.progress !== next.progress ||
    previous.startedAt !== next.startedAt
  ) {
    return true;
  }
  if ((previous.etaAt == null) !== (next.etaAt == null)) return true;
  if (previous.etaAt != null && next.etaAt != null) {
    // Resend when the estimate moves by more than a minute.
    return Math.abs(previous.etaAt - next.etaAt) > 60_000;
  }
  return false;
}
