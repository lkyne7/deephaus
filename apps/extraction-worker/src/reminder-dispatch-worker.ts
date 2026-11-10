import { setTimeout as delay } from "node:timers/promises";

type Options = {
  appBaseUrl: string;
  workerSecret: string;
  signal: AbortSignal;
  pollMs?: number;
  fetcher?: typeof fetch;
  log?: (message: string) => void;
};

/**
 * Asks the app once a minute to send whatever study reminders are due. All the
 * deciding happens in the app; this loop only keeps time. It runs beside OCR
 * so a long extraction cannot delay a reminder.
 */
export async function runReminderDispatchWorker({
  appBaseUrl, workerSecret, signal, pollMs = 60_000, fetcher = fetch,
  log = console.log,
}: Options): Promise<void> {
  // An outage is reported once, not once a minute.
  let unavailable = false;
  while (!signal.aborted) {
    try {
      const response = await fetcher(`${appBaseUrl}/api/internal/notifications/dispatch`, {
        method: "POST",
        headers: { Authorization: `Bearer ${workerSecret}` },
        signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
      });
      if (!response.ok) {
        if (!unavailable) log(`[reminders] endpoint unavailable (${response.status}); will retry`);
        unavailable = true;
      } else {
        unavailable = false;
        const result = await response.json() as { sent?: number; failed?: number };
        if (result.sent || result.failed) {
          log(`[reminders] sent ${result.sent ?? 0}${result.failed ? `, ${result.failed} failed` : ""}`);
        }
      }
    } catch {
      if (!signal.aborted && !unavailable) log("[reminders] request interrupted; will retry");
      unavailable = true;
    }
    // One request at a time. Shutdown interrupts both network and idle waits.
    await delay(pollMs, undefined, {signal}).catch(() => undefined);
  }
}
