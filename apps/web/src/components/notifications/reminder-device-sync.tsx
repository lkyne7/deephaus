"use client";

import { useEffect } from "react";
import { refreshThisDevice } from "@/lib/notifications/client";

/** Late enough that it never competes with the first paint or the initial sync. */
const REFRESH_DELAY_MS = 10_000;

let refreshedThisLoad = false;

/**
 * Once per app load, re-registers this browser or desktop app if reminders
 * are on here. A push subscription can be renewed by the browser or dropped
 * by the server without the page hearing of it; this is what brings the two
 * back in step, and it keeps the reminder time zone following the student.
 */
export function ReminderDeviceSync() {
  useEffect(() => {
    if (refreshedThisLoad) return;
    const timer = setTimeout(() => {
      if (refreshedThisLoad || !navigator.onLine) return;
      refreshedThisLoad = true;
      void refreshThisDevice().catch(() => {
        // Tried again on the next load.
      });
    }, REFRESH_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);
  return null;
}
