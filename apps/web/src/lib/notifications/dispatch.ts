import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReminderPushPayload } from "@deephaus/shared";
import {
  DEFAULT_SECONDS_PER_REVIEW,
  chooseReminder,
  nextReminderCheck,
  type Reminder,
  type ReminderExam,
  type ReminderInput,
  type ReminderKind,
  type SentReminder,
} from "@deephaus/scheduling";
import { getExamDetail, listExams } from "@/lib/exams/service";
import { loadGlobalStudySettings } from "@/lib/fsrs/user-study-settings";
import { vapidConfig, type VapidConfig } from "@/lib/notifications/config";
import {
  loadDevices,
  loadNotificationPrefs,
  toReminderPrefs,
  type DeviceRow,
} from "@/lib/notifications/prefs";
import { deliverReminder, type DeliveryResult } from "@/lib/notifications/send";
import { startOfStudyDayIso } from "@/lib/study/day-start";

const DAY_MS = 86_400_000;
/** How far back sent reminders matter: the daily cap, spacing and the ignored back-off. */
const SENT_WINDOW_MS = 14 * DAY_MS;
const UNIQUE_VIOLATION = "23505";
/** How long after registering a device a "gone" from the push service is not believed. */
const NEW_DEVICE_MS = 2 * 60_000;

/** Where a reminder takes the student. */
export function reminderPath(reminder: Pick<Reminder, "target">): string {
  return reminder.target.type === "exam" ? `/exams/${reminder.target.id}/study` : "/review";
}

async function loadSent(
  service: SupabaseClient,
  userId: string,
  now: Date,
): Promise<SentReminder[]> {
  const { data, error } = await service
    .from("notification_log")
    .select("kind, dedupe_key, sent_at, opened_at")
    .eq("user_id", userId)
    .neq("kind", "test")
    .gte("sent_at", new Date(now.getTime() - SENT_WINDOW_MS).toISOString())
    .order("sent_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    kind: row.kind as ReminderKind,
    dedupeKey: row.dedupe_key as string,
    sentAt: new Date(row.sent_at as string),
    openedAt: row.opened_at ? new Date(row.opened_at as string) : null,
  }));
}

async function loadRegular(
  service: SupabaseClient,
  userId: string,
  now: Date,
  startOfDayIso: string,
): Promise<{ due: number; minutes: number; reviewedToday: number }> {
  const { data, error } = await service.rpc("get_dashboard_metrics", {
    p_user_id: userId,
    p_now: now.toISOString(),
    p_start_of_day: startOfDayIso,
    // Retention and streaks are not needed here; keep their windows empty.
    p_recent_since: now.toISOString(),
    p_streak_since: now.toISOString(),
  });
  if (error) throw new Error(error.message);
  const metrics = (data ?? {}) as {
    per_deck?: Array<{ due_count?: number }>;
    reviewed_today?: number;
  };
  const due = (metrics.per_deck ?? []).reduce((sum, deck) => sum + Number(deck.due_count ?? 0), 0);
  return {
    due,
    minutes: Math.ceil((due * DEFAULT_SECONDS_PER_REVIEW) / 60),
    reviewedToday: Number(metrics.reviewed_today ?? 0),
  };
}

async function loadLastReviewAt(service: SupabaseClient, userId: string): Promise<Date | null> {
  const { data, error } = await service
    .from("review_logs")
    .select("review")
    .eq("user_id", userId)
    .eq("undone", false)
    .order("review", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const latest = data?.[0]?.review as string | undefined;
  return latest ? new Date(latest) : null;
}

export interface StudentReminderState {
  input: ReminderInput;
  devices: DeviceRow[];
}

/** Everything the rules need to know about one student, as of now. */
export async function loadStudentReminderState(
  service: SupabaseClient,
  userId: string,
  now: Date,
): Promise<StudentReminderState> {
  const [stored, devices, global, sent, examList, lastReviewAt] = await Promise.all([
    loadNotificationPrefs(service, userId),
    loadDevices(service, userId),
    loadGlobalStudySettings(service, userId),
    loadSent(service, userId, now),
    listExams(service, userId),
    loadLastReviewAt(service, userId),
  ]);
  const active = examList.exams.filter((exam) => exam.status === "active");
  const timezone = stored.timezone ?? global.timezone ?? active[0]?.timezone ?? "UTC";
  const regular = await loadRegular(
    service,
    userId,
    now,
    startOfStudyDayIso(now, global.dayStartHour, timezone),
  );
  const exams: ReminderExam[] = active.map((exam) => ({
    id: exam.id,
    name: exam.name,
    examAt: new Date(exam.exam_at),
    targetRecall: exam.target_recall,
    studyWindows: exam.study_windows,
    readyNow: exam.ready_now,
    minutesNow: exam.minutes_now,
  }));
  return {
    devices: devices.filter((device) => device.enabled),
    input: {
      now,
      timezone,
      dayStartHour: global.dayStartHour,
      prefs: toReminderPrefs(stored.prefs),
      exams,
      regular,
      lastReviewAt,
      sent,
    },
  };
}

/**
 * The reminder for this student right now. An exam's forecast is only run
 * when a study-time reminder is about to go out for it, to see whether the
 * plan is far enough behind to say so instead.
 */
export async function chooseStudentReminder(
  service: SupabaseClient,
  userId: string,
  input: ReminderInput,
): Promise<Reminder | null> {
  const first = chooseReminder(input);
  if (first?.kind !== "exam_session" || !first.examId) return first;
  let projected: number | null = null;
  try {
    const detail = await getExamDetail(service, userId, first.examId);
    projected = detail.plan.projected.recall_at_exam;
  } catch {
    // Without a forecast the ordinary reminder stands.
  }
  return chooseReminder({
    ...input,
    projectedRecall: (examId) => (examId === first.examId ? projected : null),
  });
}

export interface SendResult {
  /** False when this reminder had already been recorded, so nothing was sent. */
  recorded: boolean;
  id: string | null;
  deliveries: Array<{ deviceId: string; platform: string; result: DeliveryResult }>;
}

/**
 * Record a reminder, then deliver it. Recording comes first and is unique per
 * occasion, so two dispatch runs that reach the same conclusion send it once.
 */
export async function sendReminder(
  service: SupabaseClient,
  userId: string,
  reminder: { kind: ReminderKind | "test"; examId: string | null; dedupeKey: string; title: string; body: string },
  path: string,
  devices: readonly DeviceRow[],
  vapid: VapidConfig | null = vapidConfig(),
): Promise<SendResult> {
  const { data, error } = await service
    .from("notification_log")
    .insert({
      user_id: userId,
      kind: reminder.kind,
      exam_id: reminder.examId,
      dedupe_key: reminder.dedupeKey,
      title: reminder.title,
      body: reminder.body,
      path,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { recorded: false, id: null, deliveries: [] };
    throw new Error(error.message);
  }
  const id = data.id as string;
  const payload: ReminderPushPayload = { id, title: reminder.title, body: reminder.body, path };
  const deliveries = await Promise.all(
    devices.map(async (device) => ({
      deviceId: device.id,
      platform: device.platform,
      result: await deliverReminder(device, payload, vapid),
    })),
  );
  // A subscription the push service has dropped will never work again. One
  // registered moments ago is the exception: Chrome's push service was seen to
  // answer "gone" for a subscription a couple of seconds old and accept it
  // seconds later, so those are left for the next send to judge.
  const settledBefore = Date.now() - NEW_DEVICE_MS;
  const lastSeen = new Map(devices.map((device) => [device.id, Date.parse(device.last_seen_at)]));
  const gone = deliveries
    .filter((delivery) => delivery.result === "gone")
    .map((delivery) => delivery.deviceId)
    .filter((id) => !((lastSeen.get(id) ?? 0) > settledBefore));
  if (gone.length > 0) {
    await service.from("push_devices").delete().in("id", gone);
  }
  return { recorded: true, id, deliveries };
}

export interface DispatchSummary {
  checked: number;
  sent: number;
  failed: number;
}

/**
 * One dispatcher pass: look at every student who is due a look and send at
 * most one reminder each. Called once a minute by the worker.
 */
export async function runReminderDispatch(
  service: SupabaseClient,
  options: { now?: Date; limit?: number; deadlineMs?: number } = {},
): Promise<DispatchSummary> {
  const now = options.now ?? new Date();
  const deadline = Date.now() + (options.deadlineMs ?? 45_000);
  const { data, error } = await service.rpc("claim_reminder_checks", {
    p_limit: options.limit ?? 50,
  });
  if (error) throw new Error(error.message);
  const userIds = ((data ?? []) as unknown[]).map((row) =>
    typeof row === "string" ? row : String((row as { claim_reminder_checks?: string }).claim_reminder_checks),
  );
  const summary: DispatchSummary = { checked: 0, sent: 0, failed: 0 };
  const vapid = vapidConfig();

  for (const userId of userIds) {
    // Anyone not reached keeps the five-minute claim and is picked up next time.
    if (Date.now() > deadline) break;
    summary.checked++;
    try {
      const state = await loadStudentReminderState(service, userId, now);
      let input = state.input;
      if (state.devices.length > 0) {
        const reminder = await chooseStudentReminder(service, userId, input);
        if (reminder) {
          const result = await sendReminder(
            service,
            userId,
            reminder,
            reminderPath(reminder),
            state.devices,
            vapid,
          );
          if (result.recorded) {
            summary.sent++;
            input = {
              ...input,
              sent: [
                { kind: reminder.kind, dedupeKey: reminder.dedupeKey, sentAt: now, openedAt: null },
                ...input.sent,
              ],
            };
          }
        }
      }
      await service
        .from("notification_state")
        .update({ next_check_at: nextReminderCheck(input).toISOString() })
        .eq("user_id", userId);
    } catch (cause) {
      summary.failed++;
      console.error("[reminders]", userId, cause instanceof Error ? cause.message : cause);
    }
  }
  return summary;
}
