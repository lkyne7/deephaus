"use client";

import type { DesktopBridge, RegisterDeviceBody } from "@deephaus/shared";
import { apiFetch } from "@/lib/api/fetch";

/**
 * Whether this browser can be reminded, and whether it is.
 * - unsupported: no service worker or push here (also dev builds, which run without one).
 * - blocked: the student refused notifications in the browser's own settings.
 */
export type ThisDeviceState = "unsupported" | "blocked" | "off" | "on";

const DESKTOP_DEVICE_KEY = "deephaus-reminder-device";

function getDesktopBridge(): DesktopBridge | null {
  return (window as unknown as { deephausDesktop?: DesktopBridge }).deephausDesktop ?? null;
}

/** "Chrome on macOS", for the list of devices in settings. */
export function deviceLabel(): string {
  const agent = navigator.userAgent;
  const bridge = getDesktopBridge();
  const system = /Mac/i.test(agent)
    ? "macOS"
    : /Windows/i.test(agent)
      ? "Windows"
      : /Android/i.test(agent)
        ? "Android"
        : /iPhone|iPad/i.test(agent)
          ? "iOS"
          : /Linux/i.test(agent)
            ? "Linux"
            : "this device";
  if (bridge) return `DeepHaus for ${system}`;
  const browser = /Edg\//.test(agent)
    ? "Edge"
    : /Firefox\//.test(agent)
      ? "Firefox"
      : /Chrome\//.test(agent)
        ? "Chrome"
        : /Safari\//.test(agent)
          ? "Safari"
          : "Browser";
  return `${browser} on ${system}`;
}

function timezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

async function register(body: RegisterDeviceBody): Promise<void> {
  const response = await apiFetch("/api/notifications/devices", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? "Could not turn reminders on for this device");
  }
}

async function unregister(token: string): Promise<void> {
  await apiFetch("/api/notifications/devices", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
}

function desktopToken(create: boolean): string | null {
  try {
    const stored = window.localStorage.getItem(DESKTOP_DEVICE_KEY);
    if (stored || !create) return stored;
    const token = `desktop-${crypto.randomUUID()}`;
    window.localStorage.setItem(DESKTOP_DEVICE_KEY, token);
    return token;
  } catch {
    return null;
  }
}

async function pushRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return null;
  }
  // `ready` never settles when no worker is registered, as in development.
  const registration = await navigator.serviceWorker.getRegistration();
  return registration ?? null;
}

function keyBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const padded = base64Url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64Url.length / 4) * 4, "=");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

let deviceChange: Promise<unknown> = Promise.resolve();

/**
 * Turning this device on, off, or refreshing it, one at a time. Otherwise a
 * background refresh that starts while the student is turning reminders off
 * could register the device again just after it was removed.
 */
function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  const result = deviceChange.then(work, work);
  deviceChange = result.catch(() => undefined);
  return result;
}

export async function thisDeviceState(publicKey: string | null): Promise<ThisDeviceState> {
  if (getDesktopBridge()) return desktopToken(false) ? "on" : "off";
  if (!publicKey) return "unsupported";
  const registration = await pushRegistration();
  if (!registration) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  const subscription = await registration.pushManager.getSubscription();
  return subscription && Notification.permission === "granted" ? "on" : "off";
}

/** The token this device is registered under, so settings can mark it "this device". */
export async function thisDeviceToken(): Promise<string | null> {
  if (getDesktopBridge()) return desktopToken(false);
  const registration = await pushRegistration();
  return (await registration?.pushManager.getSubscription())?.endpoint ?? null;
}

/**
 * Turn reminders on here. In a browser this is the moment the permission
 * prompt appears, so it must be called from a click.
 */
export async function enableThisDevice(publicKey: string | null): Promise<ThisDeviceState> {
  if (getDesktopBridge()) {
    return oneAtATime<ThisDeviceState>(async () => {
      const token = desktopToken(true);
      if (!token) throw new Error("This device could not be registered");
      await register({ platform: "desktop", token, label: deviceLabel(), timezone: timezone() });
      return "on";
    });
  }
  const registration = publicKey ? await pushRegistration() : null;
  if (!registration || !publicKey) return "unsupported";
  // Asked before waiting on anything else: browsers only show the prompt
  // while the click that led here still counts.
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "blocked" : "off";
  return oneAtATime<ThisDeviceState>(async () => {
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      try {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes(publicKey),
        });
      } catch {
        // Private windows refuse here even with permission granted, and say
        // so only in the browser's own words.
        throw new Error(
          "This window can't receive reminders. If it is a private window, use a regular one.",
        );
      }
    }
    await register({
      platform: "web",
      token: subscription.endpoint,
      subscription: subscription.toJSON(),
      label: deviceLabel(),
      timezone: timezone(),
    });
    return "on";
  });
}

/**
 * If reminders are on here, tell the server again. This keeps the device's
 * time zone and last-seen date current, picks up a subscription the browser
 * has renewed, and restores a registration the server dropped.
 */
export function refreshThisDevice(): Promise<void> {
  return oneAtATime(refreshDevice);
}

async function refreshDevice(): Promise<void> {
  if (getDesktopBridge()) {
    const token = desktopToken(false);
    if (token) await register({ platform: "desktop", token, label: deviceLabel(), timezone: timezone() });
    return;
  }
  const registration = await pushRegistration();
  if (!registration || Notification.permission !== "granted") return;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  await register({
    platform: "web",
    token: subscription.endpoint,
    subscription: subscription.toJSON(),
    label: deviceLabel(),
    timezone: timezone(),
  });
}

export function disableThisDevice(): Promise<ThisDeviceState> {
  return oneAtATime(disableDevice);
}

async function disableDevice(): Promise<ThisDeviceState> {
  if (getDesktopBridge()) {
    const token = desktopToken(false);
    if (token) {
      await unregister(token);
      window.localStorage.removeItem(DESKTOP_DEVICE_KEY);
    }
    return "off";
  }
  const registration = await pushRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) {
    await unregister(subscription.endpoint);
    await subscription.unsubscribe();
  }
  return "off";
}

const REMINDER_CHECK_EVENT = "deephaus:reminder-check";

/**
 * Ask the desktop app to collect its reminders now instead of at its next
 * regular look. Does nothing in a browser, where reminders are pushed.
 */
export function requestReminderCheck(): void {
  window.dispatchEvent(new Event(REMINDER_CHECK_EVENT));
}

export function onReminderCheckRequested(handler: () => void): () => void {
  window.addEventListener(REMINDER_CHECK_EVENT, handler);
  return () => window.removeEventListener(REMINDER_CHECK_EVENT, handler);
}

/** Tell the server a reminder was acted on. Best effort. */
export function markReminderOpened(id: string): void {
  void apiFetch(`/api/notifications/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ opened: true }),
    keepalive: true,
  }).catch(() => undefined);
}
