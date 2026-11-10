import type {
  ExamCardReason,
  ExamStageName,
  ExamStatus,
  ExamSummaryDto,
} from "@deephaus/shared";

/**
 * Labels and formatting for Exams. Pure, so the screens and the session's Live
 * Activity read the same words; every `now` is injectable for tests.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

const STATUS_RANK: Record<ExamStatus, number> = { active: 0, completed: 1, archived: 2 };

/** Active exams soonest first, then completed, then archived (most recent first). */
export function compareExams(
  a: Pick<ExamSummaryDto, "status" | "exam_at">,
  b: Pick<ExamSummaryDto, "status" | "exam_at">,
): number {
  const byStatus = (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9);
  if (byStatus !== 0) return byStatus;
  const at = Date.parse(a.exam_at);
  const bt = Date.parse(b.exam_at);
  return a.status === "active" ? at - bt : bt - at;
}

export function examStageLabel(stage: ExamStageName): string {
  switch (stage) {
    case "learn":
      return "Learn";
    case "strengthen":
      return "Strengthen";
    case "lock-in":
      return "Lock in";
    case "exam-day":
      return "Exam day";
    case "done":
      return "Done";
  }
}

export function examStatusLabel(status: ExamStatus): string {
  switch (status) {
    case "active":
      return "Active";
    case "completed":
      return "Completed";
    case "archived":
      return "Archived";
  }
}

/** Why a card is in the session, for the line above it. */
export function examReasonLabel(reason: ExamCardReason): string {
  switch (reason) {
    case "new":
      return "New";
    case "learning":
    case "first-learning":
      return "Learning";
    case "strengthen":
      return "Strengthen";
    case "lock-in":
      return "Lock in";
  }
}

/** A 0..1 recall as a whole percent. */
export function recallPct(recall: number): number {
  if (!Number.isFinite(recall)) return 0;
  return Math.round(Math.max(0, Math.min(1, recall)) * 100);
}

export function formatRecall(recall: number): string {
  return `${recallPct(recall)}%`;
}

/** Less than a day to go: the only time an exam is called a cram. */
export function isCramWindow(examAt: string, now: number = Date.now()): boolean {
  const ms = Date.parse(examAt) - now;
  return Number.isFinite(ms) && ms > 0 && ms < DAY_MS;
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"}`;
}

/** "in 12 days", "in 5 hours", "in under an hour", "3 days ago". */
export function examCountdown(examAt: string, now: number = Date.now()): string {
  const ms = Date.parse(examAt) - now;
  if (!Number.isFinite(ms)) return "";
  const ahead = Math.abs(ms);
  let span: string;
  if (ahead < HOUR_MS) span = ms > 0 ? "under an hour" : "less than an hour";
  else if (ahead < DAY_MS) span = plural(Math.floor(ahead / HOUR_MS), "hour");
  else span = plural(Math.floor(ahead / DAY_MS), "day");
  return ms > 0 ? `in ${span}` : `${span} ago`;
}

function safeFormat(date: Date, options: Intl.DateTimeFormatOptions, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      ...options,
      ...(timeZone ? { timeZone } : {}),
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat(undefined, options).format(date);
  }
}

/** "Fri, Nov 20", with the time when the exam has one. Shown in the exam's own zone. */
export function formatExamDate(
  exam: Pick<ExamSummaryDto, "exam_at" | "has_time"> & { timezone?: string },
): string {
  const date = new Date(exam.exam_at);
  if (Number.isNaN(date.getTime())) return "";
  const day = safeFormat(date, { weekday: "short", month: "short", day: "numeric" }, exam.timezone);
  if (!exam.has_time) return day;
  return `${day} at ${safeFormat(date, { hour: "numeric", minute: "2-digit" }, exam.timezone)}`;
}

/** A planner day key ("2026-11-20") as "Fri, Nov 20", or "Today" / "Tomorrow". */
export function formatPlanDay(dateKey: string, index: number): string {
  if (index === 0) return "Today";
  if (index === 1) return "Tomorrow";
  const [year, month, day] = dateKey.split("-").map(Number);
  if (!year || !month || !day) return dateKey;
  // Noon UTC keeps the calendar date stable whatever zone formats it.
  return safeFormat(
    new Date(Date.UTC(year, month - 1, day, 12)),
    { weekday: "short", month: "short", day: "numeric" },
    "UTC",
  );
}

function localDayIndex(ms: number): number {
  const date = new Date(ms);
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);
}

/** When something opens, on the device's clock: "at 4:30 PM", "tomorrow at 9:00 AM", "Fri at 9:00 AM". */
export function formatSessionTime(at: string, now: number = Date.now()): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  const time = safeFormat(date, { hour: "numeric", minute: "2-digit" });
  const days = localDayIndex(date.getTime()) - localDayIndex(now);
  if (days <= 0) return `at ${time}`;
  if (days === 1) return `tomorrow at ${time}`;
  if (days < 7) return `${safeFormat(date, { weekday: "short" })} at ${time}`;
  return `${safeFormat(date, { month: "short", day: "numeric" })} at ${time}`;
}

/**
 * "next session at 4:30 PM". Null when no later session is planned, or when the
 * time given has already come (the cards are simply ready).
 */
export function nextSessionLabel(
  nextSessionAt: string | null | undefined,
  now: number = Date.now(),
): string | null {
  if (!nextSessionAt) return null;
  const at = Date.parse(nextSessionAt);
  if (!Number.isFinite(at) || at <= now + MINUTE_MS) return null;
  return `next session ${formatSessionTime(nextSessionAt, now)}`;
}

/** "24 cards · 12 min" */
export function readyLabel(cards: number, minutes: number): string {
  const count = plural(Math.max(0, Math.round(cards)), "card");
  return minutes > 0 ? `${count} · ${formatMinutes(minutes)}` : count;
}

/** "45 min", "1 h 30 min". */
export function formatMinutes(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  if (whole < 60) return `${whole} min`;
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** What an exam's list row says under its name about studying now. */
export function examReadyLine(
  exam: Pick<ExamSummaryDto, "ready_now" | "minutes_now" | "next_session_at">,
  now: number = Date.now(),
): string {
  if (exam.ready_now > 0) return `${readyLabel(exam.ready_now, exam.minutes_now)} ready`;
  const next = nextSessionLabel(exam.next_session_at, now);
  return next ? `Done for now · ${next}` : "Done for now";
}

/** The label for a daily time choice: null is no cap. */
export function dailyCapLabel(minutes: number | null): string {
  return minutes == null ? "No limit" : `${formatMinutes(minutes)} a day`;
}

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
