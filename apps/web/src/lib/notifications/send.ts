import webpush from "web-push";
import type { ReminderPushPayload } from "@deephaus/shared";
import type { VapidConfig } from "@/lib/notifications/config";
import type { DeviceRow } from "@/lib/notifications/prefs";

export type DeliveryResult =
  /** Handed to the push service. */
  | "sent"
  /** Nothing to push: the open desktop app collects its own reminders. */
  | "queued"
  /** The push service says this subscription no longer exists. */
  | "gone"
  /** This server cannot reach this kind of device yet. */
  | "unsupported"
  | "failed";

/** How long the push service keeps a reminder for a browser that is offline. */
const TTL_SECONDS = 60 * 60;

function isSubscription(value: unknown): value is webpush.PushSubscription {
  const subscription = value as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null;
  return (
    typeof subscription?.endpoint === "string" &&
    typeof subscription.keys?.p256dh === "string" &&
    typeof subscription.keys?.auth === "string"
  );
}

function pushServiceHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "unknown";
  }
}

/** Deliver one reminder to one device. Never throws: a dead device is a result, not an error. */
export async function deliverReminder(
  device: Pick<DeviceRow, "platform" | "subscription">,
  payload: ReminderPushPayload,
  vapid: VapidConfig | null,
): Promise<DeliveryResult> {
  if (device.platform === "desktop") return "queued";
  if (device.platform !== "web") return "unsupported";
  if (!vapid) return "unsupported";
  if (!isSubscription(device.subscription)) return "gone";
  try {
    await webpush.sendNotification(device.subscription, JSON.stringify(payload), {
      TTL: TTL_SECONDS,
      vapidDetails: {
        subject: vapid.subject,
        publicKey: vapid.publicKey,
        privateKey: vapid.privateKey,
      },
    });
    return "sent";
  } catch (error) {
    const status = (error as { statusCode?: number } | null)?.statusCode;
    // The endpoint itself is a secret; its host is enough to tell services apart.
    console.warn("[reminders] push not accepted", {
      status: status ?? (error instanceof Error ? error.message : "unknown"),
      service: pushServiceHost(device.subscription.endpoint),
    });
    // The browser unsubscribed, or the subscription expired.
    return status === 404 || status === 410 ? "gone" : "failed";
  }
}
