"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import type {
  NotificationDeviceDto,
  NotificationPrefsDto,
  NotificationSettingsDto,
} from "@deephaus/shared";
import { apiFetch } from "@/lib/api/fetch";
import {
  disableThisDevice,
  enableThisDevice,
  refreshThisDevice,
  requestReminderCheck,
  thisDeviceState,
  type ThisDeviceState,
} from "@/lib/notifications/client";
import { SettingsLoadingState } from "@/components/settings/settings-shell";

export const REMINDER_SETTINGS_KEY = "/api/notifications/settings";

/** Minutes after midnight to the "HH:MM" a time input wants, and back. */
export function minutesToTimeValue(minutes: number): string {
  const clamped = Math.max(0, Math.min(1439, Math.round(minutes)));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

export function timeValueToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

const PLATFORM_LABEL: Record<NotificationDeviceDto["platform"], string> = {
  web: "Browser",
  desktop: "Desktop app",
  ios: "iPhone",
};

/** What the button and the line under it say for each state of this device. */
export function thisDeviceCopy(state: ThisDeviceState | null): { status: string; action: string | null } {
  switch (state) {
    case "on":
      return { status: "Reminders are on for this device.", action: "Turn off" };
    case "off":
      return { status: "Reminders are off for this device.", action: "Turn on" };
    case "blocked":
      return {
        status:
          "Notifications are blocked for this site. Allow them in your browser's site settings, then turn reminders on here.",
        action: null,
      };
    case "unsupported":
      return { status: "This browser can't show reminders from DeepHaus.", action: null };
    default:
      return { status: "Checking this device…", action: null };
  }
}

/** Whether a test reminder reached at least one device. */
export function testWasDelivered(deliveries: ReadonlyArray<{ result: string }> | undefined): boolean {
  return (deliveries ?? []).some((delivery) => delivery.result === "sent" || delivery.result === "queued");
}

/**
 * How long after a browser is turned on its reminders can still go missing.
 * The server allows a new device the same two minutes before it believes a
 * push service that calls it gone.
 */
const JUST_TURNED_ON_MS = 2 * 60_000;

/**
 * What to say once a test reminder has been sent. The push service can accept
 * a reminder for a browser that subscribed moments ago and never deliver it,
 * and nothing tells the server, so a student who tests straight after turning
 * reminders on is told what to do if nothing shows.
 */
export function testSentNotice(
  deliveries: ReadonlyArray<{ platform?: string; result: string }> | undefined,
  turnedOnMsAgo: number | null,
): string {
  const pushedToBrowser = (deliveries ?? []).some(
    (delivery) => delivery.platform === "web" && delivery.result === "sent",
  );
  if (pushedToBrowser && turnedOnMsAgo !== null && turnedOnMsAgo < JUST_TURNED_ON_MS) {
    return "Test reminder sent. A browser that was only just turned on can miss its first reminder. If nothing appears, wait half a minute and send another.";
  }
  return "Test reminder sent. It should appear within a few seconds.";
}

async function send<T>(path: string, method: string, body?: unknown): Promise<T> {
  const response = await apiFetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok) throw new Error(payload?.error ?? "Something went wrong");
  return payload as T;
}

export function RemindersSection() {
  const { data, error, mutate } = useSWR<NotificationSettingsDto>(REMINDER_SETTINGS_KEY);
  const [device, setDevice] = useState<ThisDeviceState | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // When this device was turned on from this page, if it was.
  const turnedOnAt = useRef<number | null>(null);
  const publicKey = data?.web_push_public_key ?? null;

  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    void thisDeviceState(publicKey).then((state) => {
      if (!cancelled) setDevice(state);
    });
    return () => {
      cancelled = true;
    };
  }, [data, publicKey]);

  const run = useCallback(async (work: () => Promise<void>) => {
    setBusy(true);
    setNotice(null);
    try {
      await work();
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }, []);

  const savePrefs = (patch: Partial<NotificationPrefsDto>) =>
    run(async () => {
      // Show the change at once; the server's answer replaces it.
      await mutate(send<NotificationSettingsDto>(REMINDER_SETTINGS_KEY, "PATCH", patch), {
        optimisticData: data ? { ...data, prefs: { ...data.prefs, ...patch } } : undefined,
        rollbackOnError: true,
        revalidate: false,
      });
    });

  const toggleDevice = () =>
    run(async () => {
      const wasOn = device === "on";
      const next = wasOn ? await disableThisDevice() : await enableThisDevice(publicKey);
      turnedOnAt.current = !wasOn && next === "on" ? Date.now() : null;
      setDevice(next);
      await mutate();
    });

  const sendTest = () =>
    run(async () => {
      const { deliveries } = await send<{ deliveries: Array<{ platform: string; result: string }> }>(
        "/api/notifications/test",
        "POST",
      );
      if (!testWasDelivered(deliveries)) {
        // The usual cause is a registration the push service no longer
        // accepts; renewing it is what makes the next try work.
        await refreshThisDevice().catch(() => undefined);
        await mutate();
        throw new Error("The test reminder didn't get through. Wait a moment and try again.");
      }
      requestReminderCheck();
      setNotice(
        testSentNotice(deliveries, turnedOnAt.current === null ? null : Date.now() - turnedOnAt.current),
      );
    });

  const removeDevice = (id: string) =>
    run(async () => {
      await send("/api/notifications/devices", "DELETE", { id });
      await mutate();
      setDevice(await thisDeviceState(publicKey));
    });

  if (error && !data) {
    return <p className="dhs-muted">Reminder settings could not be loaded. Reload to try again.</p>;
  }
  if (!data) return <SettingsLoadingState label="Loading reminders…" />;

  const { prefs, devices } = data;
  const copy = thisDeviceCopy(device);
  const timeRow = (
    id: string,
    label: string,
    value: number,
    key: "daily_time" | "quiet_start" | "quiet_end",
  ) => (
    <div className="dhs-row">
      <label className="dhs-row__main" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="input dhs-select"
        type="time"
        value={minutesToTimeValue(value)}
        disabled={busy || !prefs.enabled}
        onChange={(event) => {
          const minutes = timeValueToMinutes(event.target.value);
          if (minutes !== null && minutes !== value) void savePrefs({ [key]: minutes });
        }}
      />
    </div>
  );
  const switchRow = (
    label: string,
    help: string,
    checked: boolean,
    key: "enabled" | "exam_reminders" | "daily_reviews",
    disabled = false,
  ) => (
    <div className="dhs-row">
      <div className="dhs-row__main">
        <div className="dhs-row__title">{label}</div>
        <p className="dhs-muted">{help}</p>
      </div>
      <button
        type="button"
        className="dh-toggle"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={busy || disabled}
        onClick={() => void savePrefs({ [key]: !checked })}
      />
    </div>
  );

  return (
    <>
      <section className="dhs-sec">
        <h2>This device</h2>
        <div className="dhs-row dhs-row--flush">
          <p className="dhs-row__main dhs-muted" role="status">
            {copy.status}
          </p>
          {device === "on" ? (
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void sendTest()}>
              Send a test
            </button>
          ) : null}
          {copy.action ? (
            <button
              type="button"
              className={`btn btn-sm ${device === "on" ? "btn-secondary" : "btn-primary"}`}
              disabled={busy}
              onClick={() => void toggleDevice()}
            >
              {copy.action}
            </button>
          ) : null}
        </div>
        {notice ? (
          <p className="dhs-help" role="status">
            {notice}
          </p>
        ) : null}
      </section>

      <section className="dhs-sec">
        <h2>What to remind me about</h2>
        {switchRow("Reminders", "Turn every reminder on or off, on all your devices.", prefs.enabled, "enabled")}
        {switchRow(
          "Exams",
          "When exam cards are ready at your study times, the evening before, and a last look on the day.",
          prefs.exam_reminders,
          "exam_reminders",
          !prefs.enabled,
        )}
        {switchRow(
          "Daily reviews",
          "Once a day, when cards are due and you haven't studied yet.",
          prefs.daily_reviews,
          "daily_reviews",
          !prefs.enabled,
        )}
      </section>

      <section className="dhs-sec">
        <h2>When</h2>
        {timeRow("reminder-daily-time", "Daily reminder", prefs.daily_time, "daily_time")}
        {timeRow("reminder-quiet-start", "Quiet from", prefs.quiet_start, "quiet_start")}
        {timeRow("reminder-quiet-end", "Quiet until", prefs.quiet_end, "quiet_end")}
        <p className="dhs-help">
          Nothing is sent during quiet hours. On an ordinary day you get at most two reminders, and
          up to four when an exam is within two days. Exams use their own study times when they have
          them.
        </p>
      </section>

      {devices.length > 0 ? (
        <section className="dhs-sec">
          <h2>Devices</h2>
          {devices.map((entry) => (
            <div className="dhs-row" key={entry.id}>
              <div className="dhs-row__main">
                <div className="dhs-row__title">{entry.label ?? PLATFORM_LABEL[entry.platform]}</div>
                <p className="dhs-muted">
                  {PLATFORM_LABEL[entry.platform]} · last seen{" "}
                  {new Date(entry.last_seen_at).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </p>
              </div>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={busy}
                onClick={() => void removeDevice(entry.id)}
              >
                Remove
              </button>
            </div>
          ))}
        </section>
      ) : null}
    </>
  );
}
