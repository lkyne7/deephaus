/**
 * Convert one Anki card's `revlog` rows into DeepHaus `review_logs` fields
 * (which mirror a ts-fsrs ReviewLog: the card's state *before* each grade).
 *
 * Anki records the grade, timing and intervals of each review but not the FSRS
 * memory state at that moment, so stability and difficulty are stored as 0
 * (unknown). Manual reschedules and resets carry no grade and are skipped.
 */

export interface AnkiRevlogRow {
  /** Review time in epoch milliseconds. */
  id: number;
  /** 1=again, 2=hard, 3=good, 4=easy; 0 for manual reschedules. */
  ease: number;
  /** Interval after the review: positive = days, negative = seconds. */
  ivl: number;
  /** Interval before the review, same units as `ivl`. */
  lastIvl: number;
  /** 0=learn, 1=review, 2=relearn, 3=filtered, 4=manual, 5=rescheduled. */
  type: number;
}

export interface FsrsReviewLogFields {
  rating: number;
  /** ts-fsrs State before the grade: 0=new, 1=learning, 2=review, 3=relearning. */
  state: number;
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  last_elapsed_days: number;
  scheduled_days: number;
  review: string;
}

const DAY_MS = 86_400_000;
const SECONDS_PER_DAY = 86_400;

function intervalDays(ivl: number): number {
  if (ivl > 0) return ivl;
  if (ivl < 0) return -ivl / SECONDS_PER_DAY;
  return 0;
}

function stateBefore(row: AnkiRevlogRow, isFirst: boolean): number {
  switch (row.type) {
    case 0:
      return isFirst ? 0 : 1;
    case 1:
      return 2;
    case 2:
      return 3;
    default:
      // Filtered-deck reviews: a graduated card was in review, otherwise learning.
      return row.lastIvl > 0 ? 2 : 1;
  }
}

/** Map a card's revlog rows, in any order, to review logs oldest first. */
export function ankiRevlogToFsrsLogs(
  rows: AnkiRevlogRow[],
  now: Date = new Date(),
): FsrsReviewLogFields[] {
  const graded = rows
    .filter((row) => row.ease >= 1 && row.ease <= 4 && row.type >= 0 && row.type <= 3)
    .sort((a, b) => a.id - b.id);

  const logs: FsrsReviewLogFields[] = [];
  let previousAt: number | null = null;
  let previousElapsed = 0;

  for (const row of graded) {
    const reviewedAt = Math.min(row.id, now.getTime());
    const elapsed = previousAt == null ? 0 : Math.max(0, Math.floor((reviewedAt - previousAt) / DAY_MS));
    const scheduledDays = intervalDays(row.lastIvl);
    const dueAt = previousAt == null ? reviewedAt : previousAt + scheduledDays * DAY_MS;

    logs.push({
      rating: row.ease,
      state: stateBefore(row, logs.length === 0),
      due: new Date(dueAt).toISOString(),
      stability: 0,
      difficulty: 0,
      elapsed_days: elapsed,
      last_elapsed_days: previousElapsed,
      scheduled_days: scheduledDays,
      review: new Date(reviewedAt).toISOString(),
    });

    previousAt = reviewedAt;
    previousElapsed = elapsed;
  }

  return logs;
}
