"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import useSWR from "swr";
import type { NotificationSettingsDto } from "@deephaus/shared";
import { REMINDER_SETTINGS_KEY } from "@/components/settings/reminders-section";
import { enableThisDevice, thisDeviceState, type ThisDeviceState } from "@/lib/notifications/client";
import { settingsPath } from "@/lib/settings/tabs";

const DISMISSED_KEY = "deephaus-reminder-prompt-dismissed";

function wasDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Offers reminders at the moment they are useful: on an exam the student has
 * just set up. The browser's own permission prompt only appears after they
 * choose to turn reminders on here, never on page load.
 */
export function ExamReminderPrompt() {
  const { data } = useSWR<NotificationSettingsDto>(REMINDER_SETTINGS_KEY);
  const [state, setState] = useState<ThisDeviceState | null>(null);
  const [hidden, setHidden] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const publicKey = data?.web_push_public_key ?? null;

  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    setHidden(wasDismissed());
    void thisDeviceState(publicKey).then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [data, publicKey]);

  // Only when it can be turned on with one click and the student has not said no.
  if (hidden || state !== "off" || data?.prefs.enabled === false) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Without storage it simply shows again next time.
    }
    setHidden(true);
  };

  const turnOn = async () => {
    setBusy(true);
    setError(null);
    try {
      setState(await enableThisDevice(publicKey));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not turn reminders on");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dh-note exam-reminder-prompt" role="note">
      <i className="ri-notification-3-line" aria-hidden />
      <div className="exam-reminder-prompt__text">
        <span>
          Get a reminder when your next session is ready, the evening before, and on the day.{" "}
          <Link href={settingsPath("reminders")}>Reminder settings</Link>
        </span>
        {error ? <span role="alert">{error}</span> : null}
      </div>
      <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => void turnOn()}>
        Turn on reminders
      </button>
      <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={dismiss}>
        Not now
      </button>
    </div>
  );
}
