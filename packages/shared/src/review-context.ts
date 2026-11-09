/** Where a recorded review was answered (`review_logs.context`). */
export const REVIEW_CONTEXTS = ["study", "exam", "cram"] as const;
export type ReviewContext = (typeof REVIEW_CONTEXTS)[number];

/** Longest answer time `review_logs.response_ms` accepts. */
export const MAX_RESPONSE_MS = 3_600_000;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * These three fields describe an answer, not its schedule, so an unusable
 * value is dropped rather than failing the review. `apply_card_review` applies
 * the same rules to what it is sent.
 */
export function normalizeReviewContext(value: unknown): ReviewContext {
  return REVIEW_CONTEXTS.includes(value as ReviewContext)
    ? (value as ReviewContext)
    : "study";
}

export function normalizeExamId(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

export function normalizeResponseMs(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const ms = Math.round(value);
  return ms >= 0 && ms <= MAX_RESPONSE_MS ? ms : null;
}

/** Time spent on a card shown at `shownAt` (epoch ms), capped at the recorded maximum. */
export function responseMsSince(shownAt: number, now = Date.now()): number {
  return Math.min(MAX_RESPONSE_MS, Math.max(0, Math.round(now - shownAt)));
}
