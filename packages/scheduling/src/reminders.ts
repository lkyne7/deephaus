import { startOfStudyDay } from "./day-start";

/**
 * Study reminders: which one, if any, a student should get right now.
 *
 * Nothing is scheduled ahead of time. The dispatcher asks this function every
 * few minutes with the student's current state, so a reminder is always judged
 * against what is true when it would be sent: a session finished on another
 * device, an exam moved, or cards already studied all take effect at once.
 */

export type ReminderKind =
  /** A short look at the shakiest cards in the last hours before an exam. */
  | "warm_up"
  /** The evening before an exam. */
  | "lock_in"
  /** Later the same day, close to an exam, once more cards are worth studying. */
  | "next_pass"
  /** At one of the student's chosen study times, with exam cards ready. */
  | "exam_session"
  /** At a study time, when the plan is heading well below the target. */
  | "behind"
  /** Regular reviews are due and nothing has been studied today. */
  | "daily_reviews";

export interface ReminderPrefs {
  enabled: boolean;
  examReminders: boolean;
  dailyReviews: boolean;
  /** Quiet hours, as minutes after local midnight. They may wrap past midnight. */
  quietStart: number;
  quietEnd: number;
  /** When to nudge about regular reviews, and exams with no study times of their own. */
  dailyTime: number;
}

export const DEFAULT_REMINDER_PREFS: ReminderPrefs = {
  enabled: true,
  examReminders: true,
  dailyReviews: true,
  quietStart: 22 * 60,
  quietEnd: 8 * 60,
  dailyTime: 19 * 60,
};

export interface ReminderExam {
  id: string;
  name: string;
  examAt: Date;
  targetRecall: number;
  /** Preferred study times, minutes after local midnight. */
  studyWindows: readonly number[];
  readyNow: number;
  minutesNow: number;
}

export interface SentReminder {
  kind: ReminderKind;
  dedupeKey: string;
  sentAt: Date;
  /** Set when the student tapped it. */
  openedAt: Date | null;
}

export interface ReminderInput {
  now: Date;
  timezone: string;
  dayStartHour: number;
  prefs: ReminderPrefs;
  /** Active exams only. */
  exams: readonly ReminderExam[];
  regular: { due: number; minutes: number; reviewedToday: number };
  lastReviewAt: Date | null;
  /** Reminders sent in the last two weeks or so. */
  sent: readonly SentReminder[];
  /**
   * Where an exam's plan is heading, 0 to 1. Asked for only when it could
   * change the answer, because it costs a forecast.
   */
  projectedRecall?: (examId: string) => number | null;
}

export type ReminderTarget = { type: "study" } | { type: "exam"; id: string };

export interface Reminder {
  kind: ReminderKind;
  examId: string | null;
  /** Stable for one occasion, so the same reminder is never sent twice. */
  dedupeKey: string;
  title: string;
  body: string;
  target: ReminderTarget;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

/** How long after a study time a reminder for it may still go out. */
const SLOT_MINUTES = 30;
/** Never interrupt someone who is studying or has just stopped. */
const RECENT_REVIEW_MS = 10 * MINUTE_MS;
const MIN_SPACING_MS = 60 * MINUTE_MS;
const NEXT_PASS_GAP_MS = 90 * MINUTE_MS;
const DAILY_CAP = 2;
/** With an exam inside two days, same-day passes are the point. */
const CLOSE_EXAM_CAP = 4;
const CLOSE_EXAM_HOURS = 48;
const WARM_UP_HOURS = 3;
const WARM_UP_CUTOFF_MS = 20 * MINUTE_MS;
const LOCK_IN_HOURS = 30;
const LOCK_IN_FROM_MINUTES = 17 * 60;
/** A plan this far under its target is worth saying so. */
const BEHIND_MARGIN = 0.05;
/** After this many unopened reminders of one kind in a row, it is sent half as often. */
const IGNORED_BEFORE_BACKOFF = 3;
const BACKOFF_MS = 47 * HOUR_MS;
const CHECK_EVERY_MS = 5 * MINUTE_MS;

interface LocalTime {
  /** YYYY-MM-DD in the student's timezone. */
  dateKey: string;
  /** Minutes after local midnight. */
  minutes: number;
}

function localTime(date: Date, timezone: string): LocalTime {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
  } catch {
    return localTime(date, "UTC");
  }
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return {
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

function clockLabel(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  } catch {
    return clockLabel(date, "UTC");
  }
}

function inQuietHours(minutes: number, prefs: ReminderPrefs): boolean {
  const { quietStart, quietEnd } = prefs;
  if (quietStart === quietEnd) return false;
  return quietStart > quietEnd
    ? minutes >= quietStart || minutes < quietEnd
    : minutes >= quietStart && minutes < quietEnd;
}

/** Whole local days from today to the exam's day: 0 is today, 1 tomorrow. */
function daysUntil(exam: ReminderExam, now: Date, timezone: string): number {
  const today = Date.parse(`${localTime(now, timezone).dateKey}T00:00:00Z`);
  const examDay = Date.parse(`${localTime(exam.examAt, timezone).dateKey}T00:00:00Z`);
  return Math.round((examDay - today) / (24 * HOUR_MS));
}

function whenLabel(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

function work(cards: number, minutes: number): string {
  return `${cards.toLocaleString("en-US")} card${cards === 1 ? "" : "s"} · about ${Math.max(1, minutes)} min`;
}

function percent(value: number): number {
  return Math.round(value * 100);
}

/** The study time whose slot `minutes` falls in, if any. */
function openSlot(windows: readonly number[], minutes: number): number | null {
  for (const window of windows) {
    if (minutes >= window && minutes < window + SLOT_MINUTES) return window;
  }
  return null;
}

function backedOff(kind: ReminderKind, input: ReminderInput): boolean {
  const ofKind = input.sent
    .filter((reminder) => reminder.kind === kind)
    .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime());
  const recent = ofKind.slice(0, IGNORED_BEFORE_BACKOFF);
  if (recent.length < IGNORED_BEFORE_BACKOFF) return false;
  if (recent.some((reminder) => reminder.openedAt)) return false;
  return input.now.getTime() - recent[0]!.sentAt.getTime() < BACKOFF_MS;
}

function sentCap(input: ReminderInput): number {
  const closeExam = input.exams.some((exam) => {
    const hours = (exam.examAt.getTime() - input.now.getTime()) / HOUR_MS;
    return hours > 0 && hours <= CLOSE_EXAM_HOURS;
  });
  return closeExam ? CLOSE_EXAM_CAP : DAILY_CAP;
}

function sentToday(input: ReminderInput): number {
  const dayStart = startOfStudyDay(input.now, input.dayStartHour, input.timezone).getTime();
  return input.sent.filter((reminder) => reminder.sentAt.getTime() >= dayStart).length;
}

function lastSentAt(input: ReminderInput): number | null {
  let latest: number | null = null;
  for (const reminder of input.sent) {
    const at = reminder.sentAt.getTime();
    if (latest === null || at > latest) latest = at;
  }
  return latest;
}

function examCandidates(input: ReminderInput, local: LocalTime): Reminder[] {
  const { now, timezone, prefs } = input;
  const nowMs = now.getTime();
  const out: Reminder[] = [];
  const exams = [...input.exams].sort((a, b) => a.examAt.getTime() - b.examAt.getTime());

  for (const exam of exams) {
    const leftMs = exam.examAt.getTime() - nowMs;
    if (leftMs <= 0 || exam.readyNow <= 0) continue;
    const hoursLeft = leftMs / HOUR_MS;
    const target: ReminderTarget = { type: "exam", id: exam.id };
    const todo = work(exam.readyNow, exam.minutesNow);

    if (hoursLeft <= WARM_UP_HOURS && leftMs >= WARM_UP_CUTOFF_MS) {
      out.push({
        kind: "warm_up",
        examId: exam.id,
        dedupeKey: `warm_up:${exam.id}`,
        title: `${exam.name} is at ${clockLabel(exam.examAt, timezone)}`,
        body: `A last look: ${todo}.`,
        target,
      });
      continue;
    }

    if (hoursLeft <= LOCK_IN_HOURS && local.minutes >= LOCK_IN_FROM_MINUTES) {
      out.push({
        kind: "lock_in",
        examId: exam.id,
        dedupeKey: `lock_in:${exam.id}`,
        title: `${exam.name} is ${whenLabel(daysUntil(exam, now, timezone))}`,
        body: `One pass tonight: ${todo}.`,
        target,
      });
    }

    const sinceReview = input.lastReviewAt ? nowMs - input.lastReviewAt.getTime() : null;
    if (
      hoursLeft <= CLOSE_EXAM_HOURS &&
      input.regular.reviewedToday > 0 &&
      sinceReview !== null &&
      sinceReview >= NEXT_PASS_GAP_MS
    ) {
      const bucket = Math.floor(local.minutes / (NEXT_PASS_GAP_MS / MINUTE_MS));
      out.push({
        kind: "next_pass",
        examId: exam.id,
        dedupeKey: `next_pass:${exam.id}:${local.dateKey}:${bucket}`,
        title: "Your next pass is ready",
        body: `${exam.name}: ${todo}.`,
        target,
      });
    }

    const windows = exam.studyWindows.length > 0 ? exam.studyWindows : [prefs.dailyTime];
    const slot = openSlot(windows, local.minutes);
    if (slot === null) continue;
    const projected = input.projectedRecall?.(exam.id) ?? null;
    if (projected !== null && projected < exam.targetRecall - BEHIND_MARGIN) {
      out.push({
        kind: "behind",
        examId: exam.id,
        dedupeKey: `behind:${exam.id}:${local.dateKey}`,
        title: `${exam.name} is heading for ${percent(projected)}%`,
        body: `Your target is ${percent(exam.targetRecall)}%. Ready now: ${todo}.`,
        target,
      });
    } else {
      out.push({
        kind: "exam_session",
        examId: exam.id,
        dedupeKey: `exam_session:${exam.id}:${local.dateKey}:${slot}`,
        title: `${exam.name} is ${whenLabel(daysUntil(exam, now, timezone))}`,
        body: `Ready now: ${todo}.`,
        target,
      });
    }
  }
  return out;
}

function dailyCandidate(input: ReminderInput, local: LocalTime): Reminder | null {
  const { regular, prefs } = input;
  if (regular.due <= 0 || regular.reviewedToday > 0) return null;
  if (openSlot([prefs.dailyTime], local.minutes) === null) return null;
  return {
    kind: "daily_reviews",
    examId: null,
    dedupeKey: `daily_reviews:${local.dateKey}`,
    title: `${regular.due.toLocaleString("en-US")} card${regular.due === 1 ? "" : "s"} due`,
    body: `About ${Math.max(1, regular.minutes)} min keeps today's reviews on schedule.`,
    target: { type: "study" },
  };
}

/** The reminder to send right now, or null when the student should be left alone. */
export function chooseReminder(input: ReminderInput): Reminder | null {
  const { prefs, now } = input;
  if (!prefs.enabled) return null;
  const local = localTime(now, input.timezone);
  if (inQuietHours(local.minutes, prefs)) return null;
  const nowMs = now.getTime();
  if (input.lastReviewAt && nowMs - input.lastReviewAt.getTime() < RECENT_REVIEW_MS) return null;
  const last = lastSentAt(input);
  if (last !== null && nowMs - last < MIN_SPACING_MS) return null;
  if (sentToday(input) >= sentCap(input)) return null;

  const already = new Set(input.sent.map((reminder) => reminder.dedupeKey));
  const candidates = [
    ...(prefs.examReminders ? examCandidates(input, local) : []),
    ...(prefs.dailyReviews ? [dailyCandidate(input, local)] : []),
  ];
  // Most time-critical first: an exam hours away outranks one next week.
  const rank: Record<ReminderKind, number> = {
    warm_up: 0,
    lock_in: 1,
    next_pass: 2,
    behind: 3,
    exam_session: 4,
    daily_reviews: 5,
  };
  const eligible = candidates
    .filter((candidate): candidate is Reminder => candidate !== null)
    .filter((candidate) => !already.has(candidate.dedupeKey))
    // The one-off exam reminders are too important to thin out.
    .filter(
      (candidate) =>
        candidate.kind === "warm_up" || candidate.kind === "lock_in" || !backedOff(candidate.kind, input),
    )
    .sort((a, b) => rank[a.kind] - rank[b.kind]);
  return eligible[0] ?? null;
}

/**
 * When this student is next worth evaluating. Skipping ahead through quiet
 * hours and spent daily caps is what keeps a per-minute dispatcher cheap.
 */
export function nextReminderCheck(input: ReminderInput): Date {
  const { prefs, now, timezone } = input;
  const nowMs = now.getTime();
  if (!prefs.enabled) return new Date(nowMs + 6 * HOUR_MS);
  const local = localTime(now, timezone);
  if (inQuietHours(local.minutes, prefs)) {
    const minutesLeft = (prefs.quietEnd - local.minutes + 1440) % 1440 || 1440;
    return new Date(nowMs + minutesLeft * MINUTE_MS);
  }
  if (sentToday(input) >= sentCap(input)) {
    const dayStart = startOfStudyDay(now, input.dayStartHour, timezone).getTime();
    return new Date(Math.max(nowMs + CHECK_EVERY_MS, dayStart + 24 * HOUR_MS));
  }
  return new Date(nowMs + CHECK_EVERY_MS);
}
