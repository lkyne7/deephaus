/**
 * Anki-style summary stats for the review calendar/heatmap.
 *
 * Shared between the web and mobile dashboards so both surfaces report the same
 * numbers from the same `YYYY-MM-DD -> review count` map.
 */

export type HeatmapStats = {
  /** Reviews per elapsed day across the period (Anki's "Daily average"). */
  dailyAverage: number;
  /** Share of elapsed days with at least one review, 0–1. */
  daysLearnedPct: number;
  /** Days with at least one review. */
  daysLearned: number;
  /** Elapsed days in the period (through today for the current year). */
  elapsedDays: number;
  /** Longest run of consecutive days with reviews. */
  longestStreak: number;
  /** Run of consecutive days with reviews ending today (or yesterday). */
  currentStreak: number;
  /** Total reviews in the period. */
  totalReviews: number;
};

function isoDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function daysBetween(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  return Math.floor(ms / 86_400_000) + 1;
}

/**
 * @param counts Reviews keyed by `YYYY-MM-DD`.
 * @param year Calendar year the heatmap covers.
 * @param today Injectable for tests; defaults to now.
 */
export function computeHeatmapStats(
  counts: Record<string, number>,
  year: number,
  today: Date = new Date(),
): HeatmapStats {
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31);
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  // A past year counts all 365/366 days; the current year only counts days that
  // have actually happened, so the average isn't diluted by the future.
  const periodEnd = todayMidnight < yearEnd ? todayMidnight : yearEnd;
  const elapsedDays =
    todayMidnight < yearStart ? 0 : Math.max(0, daysBetween(yearStart, periodEnd));

  let totalReviews = 0;
  let daysLearned = 0;
  for (const [key, count] of Object.entries(counts)) {
    if (count <= 0) continue;
    if (!key.startsWith(String(year))) continue;
    totalReviews += count;
    daysLearned += 1;
  }

  let longestStreak = 0;
  let run = 0;
  const cursor = new Date(yearStart);
  while (cursor <= periodEnd) {
    if ((counts[isoDateKey(cursor)] ?? 0) > 0) {
      run += 1;
      if (run > longestStreak) longestStreak = run;
    } else {
      run = 0;
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  // The current streak walks backwards from today. A gap today alone doesn't
  // break it — Anki keeps the streak alive until you miss a full day.
  let currentStreak = 0;
  const back = new Date(todayMidnight);
  if ((counts[isoDateKey(back)] ?? 0) === 0) {
    back.setDate(back.getDate() - 1);
  }
  while ((counts[isoDateKey(back)] ?? 0) > 0) {
    currentStreak += 1;
    back.setDate(back.getDate() - 1);
  }

  return {
    dailyAverage: elapsedDays > 0 ? totalReviews / elapsedDays : 0,
    daysLearnedPct: elapsedDays > 0 ? daysLearned / elapsedDays : 0,
    daysLearned,
    elapsedDays,
    longestStreak,
    currentStreak,
    totalReviews,
  };
}

/** `12.4` → `"12.4"`, `13` → `"13"`. Keeps the footer compact. */
export function formatDailyAverage(value: number): string {
  if (value === 0) return "0";
  if (value >= 10) return String(Math.round(value));
  return value.toFixed(1);
}
