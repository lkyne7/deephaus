/** Pure helpers behind the Insights charts. */

export type DayCount = { date: string; count: number };

export type HeatmapCell = { date: Date; inYear: boolean; future: boolean };

/** A full Jan-Dec grid of Monday-first weeks, including days still to come. */
export function buildYearWeeks(year: number, now = new Date()): HeatmapCell[][] {
  const today = new Date(now);
  today.setHours(23, 59, 59, 999);
  const yearEnd = new Date(year, 11, 31, 23, 59, 59, 999);

  const cursor = new Date(year, 0, 1);
  const dow = cursor.getDay();
  cursor.setDate(cursor.getDate() + (dow === 0 ? -6 : 1 - dow));

  const weeks: HeatmapCell[][] = [];
  while (cursor <= yearEnd) {
    const week: HeatmapCell[] = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(cursor);
      week.push({ date, inYear: date.getFullYear() === year, future: date > today });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

/** Which week each month's label sits over. */
export function monthTicks(weeks: HeatmapCell[][]): Array<{ label: string; week: number }> {
  const ticks: Array<{ label: string; week: number }> = [];
  let lastMonth = -1;
  weeks.forEach((week, index) => {
    const day = week.find((cell) => cell.inYear);
    if (!day || day.date.getMonth() === lastMonth) return;
    lastMonth = day.date.getMonth();
    ticks.push({ label: day.date.toLocaleDateString("en-US", { month: "short" }), week: index });
  });
  return ticks;
}

/** Colour step 0-4 for a day, relative to the busiest day shown. */
export function heatLevel(count: number, max: number): number {
  if (count <= 0) return 0;
  if (max <= 1) return 4;
  return Math.min(4, Math.max(1, Math.ceil((count / max) * 4)));
}

/** Rolls a daily series into weeks, labelled by each week's first day. */
export function groupByWeek(days: DayCount[]): DayCount[] {
  const weeks: DayCount[] = [];
  for (let at = 0; at < days.length; at += 7) {
    const slice = days.slice(at, at + 7);
    weeks.push({ date: slice[0].date, count: slice.reduce((sum, day) => sum + day.count, 0) });
  }
  return weeks;
}

/** The busiest entry, or null when nothing happened. */
export function peakOf(days: DayCount[]): DayCount | null {
  return days.reduce<DayCount | null>(
    (peak, day) => (day.count > (peak?.count ?? 0) ? day : peak),
    null,
  );
}

export function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** "21d", "3.2mo", "1.4y", or "6h" for a sub-day average. */
export function formatInterval(days: number | null): string {
  if (days === null) return "–";
  if (days >= 365) return `${(days / 365).toFixed(1)}y`;
  if (days >= 30) return `${(days / 30).toFixed(1)}mo`;
  if (days >= 1) return `${days.toFixed(0)}d`;
  return `${(days * 24).toFixed(0)}h`;
}
