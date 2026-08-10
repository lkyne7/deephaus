/**
 * Anki-style "next day starts at" rollover. Reviews before `dayStartHour`
 * count toward the previous study day, and daily new-card limits reset at
 * that hour instead of midnight.
 */

export const DEFAULT_DAY_START_HOUR = 4;

export function clampDayStartHour(hour: unknown): number {
  const n = typeof hour === "number" ? hour : Number(hour);
  if (!Number.isFinite(n)) return DEFAULT_DAY_START_HOUR;
  return Math.min(23, Math.max(0, Math.trunc(n)));
}

/**
 * Start of the current study day: the most recent occurrence of
 * `dayStartHour`:00 in `timeZone` (falls back to the runtime's timezone).
 */
export function startOfStudyDay(
  now: Date,
  dayStartHour: number,
  timeZone?: string | null,
): Date {
  const hour = clampDayStartHour(dayStartHour);

  if (!timeZone) {
    const start = new Date(now);
    start.setHours(hour, 0, 0, 0);
    if (start.getTime() > now.getTime()) start.setDate(start.getDate() - 1);
    return start;
  }

  const offsetMs = timeZoneOffsetMs(now, timeZone);
  // Shift into local wall-clock time, snap to the rollover hour, shift back.
  const local = new Date(now.getTime() + offsetMs);
  const start = new Date(local);
  start.setUTCHours(hour, 0, 0, 0);
  if (start.getTime() > local.getTime()) start.setUTCDate(start.getUTCDate() - 1);
  return new Date(start.getTime() - offsetMs);
}

export function startOfStudyDayIso(
  now: Date,
  dayStartHour: number,
  timeZone?: string | null,
): string {
  return startOfStudyDay(now, dayStartHour, timeZone).toISOString();
}

/** Offset of `timeZone` from UTC at `at` in ms (positive when ahead of UTC). */
function timeZoneOffsetMs(at: Date, timeZone: string): number {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts: Record<string, string> = {};
    for (const part of dtf.formatToParts(at)) parts[part.type] = part.value;
    const asUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour) % 24,
      Number(parts.minute),
      Number(parts.second),
    );
    return asUtc - Math.floor(at.getTime() / 1000) * 1000;
  } catch {
    return 0;
  }
}
