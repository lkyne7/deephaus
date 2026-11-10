"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import type { ReminderDto } from "@deephaus/shared";
import { apiFetch } from "@/lib/api/fetch";
import { useDashboardStats } from "@/lib/client-cache/hooks/use-dashboard-stats";
import {
  markReminderOpened,
  onReminderCheckRequested,
  thisDeviceToken,
} from "@/lib/notifications/client";
import { buildWarmupUrls, warmRoutes } from "@/lib/desktop/route-warmup";
import { useDesktopBridge } from "./use-desktop-bridge";

/** Delay before warming routes so it never competes with the first paint or initial sync. */
const WARMUP_DELAY_MS = 12_000;

/** How often the open desktop app asks for reminders it has not shown. */
const REMINDER_POLL_MS = 60_000;
const REMINDER_PARAM = "reminder";

let warmedThisSession = false;

/**
 * Wires the Electron shell into the signed-in app: native menu shortcuts and
 * deep links navigate client-side, the dock/taskbar badge mirrors the number
 * of cards due now, study reminders are shown as native notifications while
 * the app is open, and core routes plus deck study pages are cached for a cold
 * offline launch.
 */
export function DesktopIntegration() {
  const bridge = useDesktopBridge();
  const router = useRouter();
  const { data: stats } = useDashboardStats();
  const dueNow = bridge ? stats?.due_now : undefined;
  const deckIdsKey = bridge && stats ? stats.per_deck.map((deck) => deck.deck_id).join(",") : "";
  const warmupStarted = useRef(false);

  useEffect(() => {
    if (!bridge) return;
    return bridge.onNavigate((path) => {
      // A clicked reminder carries its id, so the click can be recorded.
      const url = new URL(path, window.location.origin);
      const reminderId = url.searchParams.get(REMINDER_PARAM);
      if (reminderId) {
        markReminderOpened(reminderId);
        url.searchParams.delete(REMINDER_PARAM);
      }
      router.push(`${url.pathname}${url.search}`);
    });
  }, [bridge, router]);

  // The desktop shell has no push service, so while it is open it collects
  // its own reminders. Only when reminders are on for this device.
  useEffect(() => {
    if (!bridge) return;
    let stopped = false;
    let collecting = false;
    const collect = async () => {
      // One at a time, so a reminder is never shown twice by overlapping looks.
      if (stopped || collecting || !navigator.onLine) return;
      collecting = true;
      try {
        if (!(await thisDeviceToken())) return;
        const response = await apiFetch("/api/notifications/pending", { cache: "no-store" });
        if (!response.ok) return;
        const { reminders } = (await response.json()) as { reminders?: ReminderDto[] };
        for (const reminder of reminders ?? []) {
          if (stopped) return;
          const separator = reminder.path.includes("?") ? "&" : "?";
          bridge.notify({
            title: reminder.title,
            body: reminder.body,
            path: `${reminder.path}${separator}${REMINDER_PARAM}=${reminder.id}`,
          });
          await apiFetch(`/api/notifications/${reminder.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ shown: true }),
          });
        }
      } catch {
        // The next pass tries again.
      } finally {
        collecting = false;
      }
    };
    void collect();
    const timer = setInterval(() => void collect(), REMINDER_POLL_MS);
    // A test reminder sent from settings should appear at once.
    const stopListening = onReminderCheckRequested(() => void collect());
    return () => {
      stopped = true;
      clearInterval(timer);
      stopListening();
    };
  }, [bridge]);

  useEffect(() => {
    if (!bridge || dueNow === undefined) return;
    bridge.setBadgeCount(dueNow);
  }, [bridge, dueNow]);

  useEffect(() => {
    if (!bridge || !deckIdsKey || warmedThisSession || warmupStarted.current) return;
    if (!navigator.serviceWorker?.controller) return;
    warmupStarted.current = true;
    const controller = new AbortController();
    // Decks with cards due first: they are the ones most likely opened offline.
    const deckIds = deckIdsKey.split(",");
    const timer = setTimeout(() => {
      if (!navigator.onLine) {
        warmupStarted.current = false;
        return;
      }
      warmedThisSession = true;
      void warmRoutes(buildWarmupUrls(deckIds), undefined, controller.signal);
    }, WARMUP_DELAY_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
      if (!warmedThisSession) warmupStarted.current = false;
    };
  }, [bridge, deckIdsKey]);

  return null;
}
