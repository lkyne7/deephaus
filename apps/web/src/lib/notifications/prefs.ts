import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_NOTIFICATION_PREFS,
  type NotificationDeviceDto,
  type NotificationPlatform,
  type NotificationPrefsDto,
} from "@deephaus/shared";
import type { ReminderPrefs } from "@deephaus/scheduling";

const PREF_COLUMNS = "enabled, exam_reminders, daily_reviews, quiet_start, quiet_end, daily_time, timezone";

export interface StoredPrefs {
  prefs: NotificationPrefsDto;
  /** Zone the times are read in, as last reported by one of the student's devices. */
  timezone: string | null;
}

/** A student's reminder settings; the defaults until they change something. */
export async function loadNotificationPrefs(
  supabase: SupabaseClient,
  userId: string,
): Promise<StoredPrefs> {
  const { data, error } = await supabase
    .from("notification_prefs")
    .select(PREF_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { prefs: { ...DEFAULT_NOTIFICATION_PREFS }, timezone: null };
  return {
    prefs: {
      enabled: Boolean(data.enabled),
      exam_reminders: Boolean(data.exam_reminders),
      daily_reviews: Boolean(data.daily_reviews),
      quiet_start: Number(data.quiet_start),
      quiet_end: Number(data.quiet_end),
      daily_time: Number(data.daily_time),
    },
    timezone: typeof data.timezone === "string" && data.timezone ? data.timezone : null,
  };
}

export async function saveNotificationPrefs(
  supabase: SupabaseClient,
  userId: string,
  patch: Partial<NotificationPrefsDto> & { timezone?: string },
): Promise<StoredPrefs> {
  const { error } = await supabase
    .from("notification_prefs")
    .upsert({ user_id: userId, ...patch }, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
  return loadNotificationPrefs(supabase, userId);
}

export function toReminderPrefs(prefs: NotificationPrefsDto): ReminderPrefs {
  return {
    enabled: prefs.enabled,
    examReminders: prefs.exam_reminders,
    dailyReviews: prefs.daily_reviews,
    quietStart: prefs.quiet_start,
    quietEnd: prefs.quiet_end,
    dailyTime: prefs.daily_time,
  };
}

export interface DeviceRow {
  id: string;
  user_id: string;
  platform: NotificationPlatform;
  token: string;
  subscription: unknown;
  label: string | null;
  enabled: boolean;
  last_seen_at: string;
}

const DEVICE_COLUMNS = "id, user_id, platform, token, subscription, label, enabled, last_seen_at";

export async function loadDevices(supabase: SupabaseClient, userId: string): Promise<DeviceRow[]> {
  const { data, error } = await supabase
    .from("push_devices")
    .select(DEVICE_COLUMNS)
    .eq("user_id", userId)
    .order("last_seen_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as DeviceRow[];
}

export function deviceDto(device: DeviceRow): NotificationDeviceDto {
  return {
    id: device.id,
    platform: device.platform,
    label: device.label,
    enabled: device.enabled,
    last_seen_at: device.last_seen_at,
  };
}

/**
 * Record that this browser or app belongs to this student. A device is one
 * row whoever is signed in on it, so a row left by another account on the same
 * browser is taken over rather than duplicated. That needs the service client:
 * a student cannot touch another account's row.
 */
export async function registerDevice(
  service: SupabaseClient,
  userId: string,
  device: {
    platform: NotificationPlatform;
    token: string;
    subscription?: unknown;
    label?: string;
  },
): Promise<DeviceRow> {
  const { data, error } = await service
    .from("push_devices")
    .upsert(
      {
        user_id: userId,
        platform: device.platform,
        token: device.token,
        subscription: device.subscription ?? null,
        label: device.label?.slice(0, 120) ?? null,
        enabled: true,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "platform,token" },
    )
    .select(DEVICE_COLUMNS)
    .single();
  if (error) throw new Error(error.message);
  return data as DeviceRow;
}

export async function removeDevice(
  supabase: SupabaseClient,
  userId: string,
  match: { id?: string; token?: string },
): Promise<void> {
  let query = supabase.from("push_devices").delete().eq("user_id", userId);
  if (match.id) query = query.eq("id", match.id);
  else if (match.token) query = query.eq("token", match.token);
  else return;
  const { error } = await query;
  if (error) throw new Error(error.message);
}
