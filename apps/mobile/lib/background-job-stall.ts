/**
 * Background jobs are processed by separate workers. If a worker is down, a job stays
 * "pending" forever and the app would poll indefinitely, so give up with a clear message.
 */

/** A healthy worker claims a job within seconds; allow for a cold start or a short backlog. */
export const PENDING_TIMEOUT_MS = 3 * 60_000;
/** Once claimed, a job that reports no progress for this long is treated as stuck. */
export const STALLED_TIMEOUT_MS = 10 * 60_000;

export type JobKind = "export" | "import";

export type StallTracker = {
  startedAt: number;
  lastChangeAt: number;
  lastSignature: string | null;
};

export function createStallTracker(now = Date.now()): StallTracker {
  return { startedAt: now, lastChangeAt: now, lastSignature: null };
}

/**
 * Records the latest poll result and returns an error message when the job should be
 * given up on, or null while it is still healthy.
 */
export function checkJobStall(
  tracker: StallTracker,
  kind: JobKind,
  job: { status: string; phase?: string | null; progress?: number | null },
  now = Date.now(),
): string | null {
  const signature = `${job.status}|${job.phase ?? ""}|${job.progress ?? 0}`;
  if (signature !== tracker.lastSignature) {
    tracker.lastSignature = signature;
    tracker.lastChangeAt = now;
  }
  const noun = kind === "export" ? "export" : "import";
  if (job.status === "pending") {
    if (now - tracker.startedAt >= PENDING_TIMEOUT_MS) {
      return `The ${noun} didn't start. The ${noun} service may be unavailable; try again in a few minutes.`;
    }
    return null;
  }
  if (now - tracker.lastChangeAt >= STALLED_TIMEOUT_MS) {
    return `The ${noun} stopped making progress. Try again in a few minutes.`;
  }
  return null;
}
