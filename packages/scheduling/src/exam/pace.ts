import { DEFAULT_SECONDS_PER_REVIEW } from "./policy";

export function rollingMedianResponseMs(values: readonly number[]): number | null {
  const sorted = values
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[midpoint] ?? null;
  return ((sorted[midpoint - 1] ?? 0) + (sorted[midpoint] ?? 0)) / 2;
}

/** Answers needed before the student's own pace fully replaces the default. */
const PACE_FULL_TRUST_SAMPLES = 20;

/**
 * The student's own pace: the median of their recent answer times, kept
 * within 5 to 120 seconds. A handful of answers says little, so until there
 * are enough the estimate moves from the default towards their median in
 * proportion to how many there are.
 */
export function estimatedSecondsPerReview(
  responseTimesMs: readonly number[],
  seedSeconds = DEFAULT_SECONDS_PER_REVIEW,
): number {
  const samples = responseTimesMs.filter((value) => Number.isFinite(value) && value > 0);
  const median = rollingMedianResponseMs(samples);
  if (median == null) return seedSeconds;
  const own = Math.max(5, Math.min(120, median / 1000));
  const trust = Math.min(1, samples.length / PACE_FULL_TRUST_SAMPLES);
  return seedSeconds + (own - seedSeconds) * trust;
}
