/** Study reminders: the wire types shared by the web API and its clients. */

export const NOTIFICATION_PLATFORMS = ["web", "desktop", "ios"] as const;
export type NotificationPlatform = (typeof NOTIFICATION_PLATFORMS)[number];

/** What a student allows. Times are minutes after local midnight. */
export type NotificationPrefsDto = {
  enabled: boolean;
  exam_reminders: boolean;
  daily_reviews: boolean;
  quiet_start: number;
  quiet_end: number;
  daily_time: number;
};

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefsDto = {
  enabled: true,
  exam_reminders: true,
  daily_reviews: true,
  quiet_start: 22 * 60,
  quiet_end: 8 * 60,
  daily_time: 19 * 60,
};

export type NotificationDeviceDto = {
  id: string;
  platform: NotificationPlatform;
  label: string | null;
  enabled: boolean;
  last_seen_at: string;
};

export type NotificationSettingsDto = {
  prefs: NotificationPrefsDto;
  devices: NotificationDeviceDto[];
  /** The key a browser subscribes with; null when browser push is not set up on this server. */
  web_push_public_key: string | null;
};

export type RegisterDeviceBody = {
  platform: NotificationPlatform;
  /** web: the push endpoint. desktop: an id the app generated. ios: the push token. */
  token: string;
  /** web only: the PushSubscription as JSON. */
  subscription?: unknown;
  label?: string;
  timezone?: string;
};

/** A reminder as a client shows it. */
export type ReminderDto = {
  id: string;
  kind: string;
  title: string;
  body: string;
  /** App-relative path to open. */
  path: string;
  sent_at: string;
};

/** What a push message carries; the service worker turns it into a notification. */
export type ReminderPushPayload = {
  id: string;
  title: string;
  body: string;
  path: string;
};
