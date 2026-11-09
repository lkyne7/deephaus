import {
  EXAM_DAILY_MINUTES_MAX,
  EXAM_DATE_ONLY_HOUR,
  type ExamPlanDayDto,
  type ExamScorePointDto,
  type ExamSnapshotDto,
  type ExamStageName,
  type ExamSummaryDto,
} from "@deephaus/shared";

/* ------------------------------------------------------------------ numbers */

/** Recall arrives as 0..1; the UI shows whole percents. */
export function recallPercent(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(Math.min(1, Math.max(0, value)) * 100);
}

export function percentLabel(value: number | null | undefined): string {
  const percent = recallPercent(value);
  return percent === null ? "—" : `${percent}%`;
}

export function cardsLabel(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? "card" : "cards"}`;
}

export function minutesLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

export function dailyCapLabel(cap: number | null): string {
  return cap === null ? "No limit" : `${minutesLabel(cap)} a day`;
}

/** A typed daily limit, or null when the field is empty or not a number. */
export function parseDailyCap(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(EXAM_DAILY_MINUTES_MAX, Math.max(1, parsed));
}

/** "50 of 65 at target". */
export function atTargetLabel(snapshot: Pick<ExamSnapshotDto, "locked_in" | "total">): string {
  return `${snapshot.locked_in.toLocaleString()} of ${snapshot.total.toLocaleString()} at target`;
}

/* ------------------------------------------------------------------- stages */

export const STAGE_LABELS: Record<ExamStageName, string> = {
  learn: "Learn",
  strengthen: "Strengthen",
  "lock-in": "Lock in",
  "exam-day": "Exam day",
  done: "Done",
};

export function stageLabel(stage: ExamStageName): string {
  return STAGE_LABELS[stage] ?? "Learn";
}

/* ----------------------------------------------------------------- grouping */

function examTime(exam: Pick<ExamSummaryDto, "exam_at">): number {
  const time = Date.parse(exam.exam_at);
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
}

export type ExamGroups = Record<"active" | "completed" | "archived", ExamSummaryDto[]>;

/** Active exams soonest first; finished and archived ones latest first. */
export function groupExams(exams: readonly ExamSummaryDto[]): ExamGroups {
  const soonest = (a: ExamSummaryDto, b: ExamSummaryDto) => examTime(a) - examTime(b);
  const latest = (a: ExamSummaryDto, b: ExamSummaryDto) => soonest(b, a);
  return {
    active: exams.filter((exam) => exam.status === "active").sort(soonest),
    completed: exams.filter((exam) => exam.status === "completed").sort(latest),
    archived: exams.filter((exam) => exam.status === "archived").sort(latest),
  };
}

/** The active exam that comes first, for Home's Exams shortcut. */
export function nearestActiveExam(exams: readonly ExamSummaryDto[] | null | undefined): ExamSummaryDto | null {
  return exams ? (groupExams(exams).active[0] ?? null) : null;
}

/** Less than a day away: the one place the app still says "Cram". */
export function isCramExam(examAt: string, now = new Date()): boolean {
  const left = Date.parse(examAt) - now.getTime();
  return Number.isFinite(left) && left > 0 && left < 86_400_000;
}

/* -------------------------------------------------------------------- dates */

/**
 * An exam with a date but no time is planned for this local time, so study
 * finishes before a morning sitting rather than running through the day.
 */
export const DATE_ONLY_EXAM_TIME = `${String(EXAM_DATE_ONLY_HOUR).padStart(2, "0")}:00`;

type ExamDateFormat = {
  timezone?: string | null;
  hasTime?: boolean;
  now?: Date;
  viewerTimeZone?: string;
  locale?: string;
};

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function safeFormat(date: Date, options: Intl.DateTimeFormatOptions, zone: string, locale?: string): string {
  const format = (timeZone?: string) =>
    new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(date).replace(/ /g, " ");
  try {
    return format(zone);
  } catch {
    return format();
  }
}

/**
 * A date-only exam is the calendar day the student picked, so it stays in the
 * exam's zone. An exact time stays there too unless that zone is UTC, which
 * nobody lives in: those read in the viewer's own time.
 */
function examZone(timezone: string | null | undefined, hasTime: boolean, viewer: string): string {
  if (!timezone) return viewer;
  return hasTime && timezone === "UTC" ? viewer : timezone;
}

/** "Friday, Nov 13", or "Friday, Nov 13 at 9:00 AM" when the exam has a time. */
export function formatExamLong(iso: string, format: ExamDateFormat = {}): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Invalid date";
  const viewer = format.viewerTimeZone ?? browserTimeZone();
  const hasTime = format.hasTime === true;
  const zone = examZone(format.timezone, hasTime, viewer);
  const now = format.now ?? new Date();
  const day = safeFormat(
    date,
    {
      weekday: "long",
      month: "short",
      day: "numeric",
      year: date.getUTCFullYear() === now.getUTCFullYear() ? undefined : "numeric",
    },
    zone,
    format.locale,
  );
  if (!hasTime) return day;
  const time = safeFormat(date, { hour: "numeric", minute: "2-digit" }, zone, format.locale);
  const place = zone === viewer ? "" : ` ${(zone.split("/").pop() ?? zone).replaceAll("_", " ")} time`;
  return `${day} at ${time}${place}`;
}

/** "Nov 13", with the year when it isn't this year. */
export function formatExamShort(iso: string, format: ExamDateFormat = {}): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Invalid date";
  const viewer = format.viewerTimeZone ?? browserTimeZone();
  const now = format.now ?? new Date();
  return safeFormat(
    date,
    {
      month: "short",
      day: "numeric",
      year: date.getUTCFullYear() === now.getUTCFullYear() ? undefined : "numeric",
    },
    examZone(format.timezone, format.hasTime === true, viewer),
    format.locale,
  );
}

/** Calendar day (YYYY-MM-DD) of an instant in a zone. */
export function dateKeyInZone(date: Date, zone: string): string {
  return safeFormat(date, { year: "numeric", month: "2-digit", day: "2-digit" }, zone, "en-CA");
}

function zonedDayNumber(date: Date, zone: string): number {
  return Date.parse(`${dateKeyInZone(date, zone)}T00:00:00Z`) / 86_400_000;
}

/**
 * How far off the exam is: hours inside the last day of an exam with a time,
 * calendar days in the exam's own zone otherwise.
 */
export function timeLeftLabel(iso: string, format: ExamDateFormat = {}): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = format.now ?? new Date();
  const left = date.getTime() - now.getTime();
  if (left <= 0) return "Passed";
  if (format.hasTime && left < 86_400_000) {
    const minutes = Math.max(1, Math.round(left / 60_000));
    if (minutes < 60) return `In ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
    const hours = Math.round(minutes / 60);
    return `In ${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  const zone = format.timezone || format.viewerTimeZone || browserTimeZone();
  const days = zonedDayNumber(date, zone) - zonedDayNumber(now, zone);
  if (days <= 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `${days} days left`;
}

type ClockFormat = { now?: Date; viewerTimeZone?: string; locale?: string };

/** "at 4:30 PM", "tomorrow at 8:00 AM" or "Fri, Nov 13 at 8:00 AM", in the viewer's time. */
export function formatSessionTime(iso: string, format: ClockFormat = {}): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = format.now ?? new Date();
  if (date.getTime() <= now.getTime()) return "now";
  const zone = format.viewerTimeZone ?? browserTimeZone();
  const time = safeFormat(date, { hour: "numeric", minute: "2-digit" }, zone, format.locale);
  const days = zonedDayNumber(date, zone) - zonedDayNumber(now, zone);
  if (days <= 0) return `at ${time}`;
  if (days === 1) return `tomorrow at ${time}`;
  const day = safeFormat(date, { weekday: "short", month: "short", day: "numeric" }, zone, format.locale);
  return `${day} at ${time}`;
}

/** "24 cards · 8 min", the size of the session that is ready now. */
export function studyNowLabel(exam: Pick<ExamSummaryDto, "ready_now" | "minutes_now">): string {
  return `${cardsLabel(exam.ready_now)} · ${minutesLabel(Math.max(1, exam.minutes_now))}`;
}

/** "Next session opens at 4:30 PM", or null when nothing more is planned. */
export function nextSessionLabel(
  exam: Pick<ExamSummaryDto, "next_session_at">,
  format: ClockFormat = {},
): string | null {
  if (!exam.next_session_at) return null;
  const when = formatSessionTime(exam.next_session_at, format);
  return when ? `Next session opens ${when}` : null;
}

function offsetAt(timestamp: number, formatter: Intl.DateTimeFormat): number {
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]),
  );
  return (
    Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    ) - timestamp
  );
}

function wallClockFormatter(timezone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
}

/**
 * The instant of a wall-clock date ("YYYY-MM-DD") and time ("HH:MM") in an
 * IANA zone. A missing time means a date-only exam.
 */
export function examAtIso(date: string, time: string | null, timezone: string): string | null {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = (time || DATE_ONLY_EXAM_TIME).split(":").map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  if (Number.isNaN(utcGuess)) return null;
  try {
    const formatter = wallClockFormatter(timezone);
    // Two passes settle normal offsets and daylight-saving boundaries.
    let result = utcGuess - offsetAt(utcGuess, formatter);
    result = utcGuess - offsetAt(result, formatter);
    return new Date(result).toISOString();
  } catch {
    return new Date(utcGuess).toISOString();
  }
}

/** The wall-clock date and time of an instant in a zone, for the form's inputs. */
export function examLocalFields(iso: string, timezone: string): { date: string; time: string } {
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return { date: "", time: DATE_ONLY_EXAM_TIME };
  let shifted: Date;
  try {
    shifted = new Date(timestamp + offsetAt(timestamp, wallClockFormatter(timezone)));
  } catch {
    shifted = new Date(timestamp);
  }
  const text = shifted.toISOString();
  return { date: text.slice(0, 10), time: text.slice(11, 16) };
}

/* ------------------------------------------------------------- study times */

export const MAX_STUDY_WINDOWS = 3;

/** Minutes after local midnight. */
export const STUDY_WINDOW_PRESETS = [
  { label: "Morning", minutes: 8 * 60 },
  { label: "Afternoon", minutes: 14 * 60 },
  { label: "Evening", minutes: 19 * 60 },
] as const;

/** "8:00 AM" for 480. */
export function formatStudyWindow(minutes: number, locale?: string): string {
  const date = new Date(Date.UTC(2000, 0, 1, Math.floor(minutes / 60), minutes % 60));
  return safeFormat(date, { hour: "numeric", minute: "2-digit" }, "UTC", locale);
}

/** "08:00" (a time input's value) to 480; null when it isn't a time. */
export function studyWindowFromTime(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!match) return null;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes >= 0 && minutes < 1440 ? minutes : null;
}

/** Add or remove a study time, kept sorted and capped at three. */
export function toggleStudyWindow(windows: readonly number[], minutes: number): number[] {
  if (windows.includes(minutes)) return windows.filter((entry) => entry !== minutes);
  if (windows.length >= MAX_STUDY_WINDOWS) return [...windows];
  return [...windows, minutes].sort((a, b) => a - b);
}

/* -------------------------------------------------------- time versus score */

/** The planner calls a plan on track within half a point of the target. */
const ON_TARGET_SLACK = 0.005;

export type CurveChoice = {
  /** Null is no daily limit. */
  minutes: number | null;
  recall: number;
  selected: boolean;
  /** The student's own limit, when it isn't one of the planner's budgets. */
  custom: boolean;
  meetsTarget: boolean;
};

/**
 * The time-versus-score curve as choices: budgets shortest first, no limit
 * last. A limit the planner didn't sample is slotted in with the plan's own
 * projection, so the current setting is always one of the rows.
 */
export function curveChoices(
  curve: readonly ExamScorePointDto[],
  cap: number | null,
  projected: number,
  target: number,
): CurveChoice[] {
  const points = new Map<number | null, number>();
  for (const point of curve) points.set(point.minutes_per_day, point.recall_at_exam);
  const custom = !points.has(cap);
  if (custom) points.set(cap, projected);
  return [...points.entries()]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a - b))
    .map(([minutes, recall]) => ({
      minutes,
      recall,
      selected: minutes === cap,
      custom: custom && minutes === cap,
      meetsTarget: recall >= target - ON_TARGET_SLACK,
    }));
}

/** The shortest daily budget that still reaches the target, if any does. */
export function shortestOnTarget(choices: readonly CurveChoice[]): CurveChoice | null {
  return choices.find((choice) => choice.meetsTarget) ?? null;
}

/** "20 min a day → 84%". */
export function curveChoiceLabel(choice: Pick<CurveChoice, "minutes" | "recall">): string {
  return `${dailyCapLabel(choice.minutes)} → ${percentLabel(choice.recall)}`;
}

export type TrackSummary = { onTrack: boolean; headline: string; detail: string };

/**
 * Where the plan is heading in plain words, and what would close the gap
 * when it falls short: more minutes, more days or fewer cards.
 */
export function trackSummary(input: {
  onTrack: boolean;
  projected: number;
  target: number;
  cap: number | null;
  typicalMinutes: number;
  peakMinutes: number;
  /** What no daily limit would reach, from the curve. */
  uncapped: number | null;
}): TrackSummary {
  const projected = recallPercent(input.projected) ?? 0;
  const target = recallPercent(input.target) ?? 0;
  const uncapped = recallPercent(input.uncapped);
  const typical = `${input.typicalMinutes} ${input.typicalMinutes === 1 ? "minute" : "minutes"} a day`;

  if (input.onTrack) {
    return {
      onTrack: true,
      headline: `On track for ${projected}%`,
      detail:
        input.cap !== null
          ? `${minutesLabel(input.cap)} a day is enough for your ${target}% target.`
          : input.typicalMinutes > 0
            ? `The plan asks for about ${typical}, ${minutesLabel(input.peakMinutes)} on the busiest day.`
            : `Your cards are already at your ${target}% target.`,
    };
  }

  const headline = `Heading for ${projected}%, below your ${target}% target`;
  if (input.cap !== null && uncapped !== null && uncapped > projected) {
    const lifted = `Without a limit the plan needs about ${typical} and reaches ${uncapped}%.`;
    return {
      onTrack: false,
      headline,
      detail:
        uncapped >= target
          ? `${minutesLabel(input.cap)} a day is not enough. ${lifted}`
          : `${minutesLabel(input.cap)} a day is not enough. ${lifted} More days or fewer cards would close the rest.`,
    };
  }
  return {
    onTrack: false,
    headline,
    detail:
      input.typicalMinutes > 0
        ? `There is not enough time before the exam, even at about ${typical}. More days or fewer cards would close the gap.`
        : "There is not enough time before the exam. More days or fewer cards would close the gap.",
  };
}

/* ------------------------------------------------------------ day-by-day */

/** 0 for a rest day, then 1 to 3 by how the day compares with the busiest. */
export function planDayLevel(minutes: number, peak: number): 0 | 1 | 2 | 3 {
  if (minutes <= 0 || peak <= 0) return 0;
  const share = minutes / peak;
  return share > 2 / 3 ? 3 : share > 1 / 3 ? 2 : 1;
}

export type PlanTotals = { minutes: number; newCards: number; reviews: number; studyDays: number; peak: number };

export function planTotals(days: readonly ExamPlanDayDto[]): PlanTotals {
  return days.reduce<PlanTotals>(
    (totals, day) => ({
      minutes: totals.minutes + day.minutes,
      newCards: totals.newCards + day.new_cards,
      reviews: totals.reviews + day.reviews,
      studyDays: totals.studyDays + (day.minutes > 0 || day.reviews > 0 ? 1 : 0),
      peak: Math.max(totals.peak, day.minutes),
    }),
    { minutes: 0, newCards: 0, reviews: 0, studyDays: 0, peak: 0 },
  );
}

/** "25 min · 12 new · 40 reviews", or "Rest day". */
export function planDayLabel(day: Pick<ExamPlanDayDto, "minutes" | "new_cards" | "reviews">): string {
  if (day.reviews <= 0 && day.minutes <= 0) return "Rest day";
  return [
    minutesLabel(Math.max(1, day.minutes)),
    day.new_cards > 0 ? `${day.new_cards.toLocaleString()} new` : null,
    `${day.reviews.toLocaleString()} ${day.reviews === 1 ? "review" : "reviews"}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/* ------------------------------------------------------------------- errors */

export function getErrorMessage(value: unknown, fallback: string): string {
  if (typeof value !== "object" || value === null) return fallback;
  const record = value as Record<string, unknown>;
  const message = record.error ?? record.message;
  return typeof message === "string" && message.trim() ? message : fallback;
}
