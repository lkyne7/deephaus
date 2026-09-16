import { setTimeout as delay } from "node:timers/promises";

type Options = {
  appBaseUrl: string;
  workerSecret: string;
  signal: AbortSignal;
  pollMs?: number;
  fetcher?: typeof fetch;
  log?: (message: string) => void;
};

/** Runs independently of OCR: a long extraction cannot starve account cleanup. */
export async function runAccountDeletionWorker({
  appBaseUrl, workerSecret, signal, pollMs = 60_000, fetcher = fetch,
  log = console.log,
}: Options): Promise<void> {
  while (!signal.aborted) {
    try {
      const response = await fetcher(`${appBaseUrl}/api/internal/account-deletion`, {
        method: "POST",
        headers: { Authorization: `Bearer ${workerSecret}` },
        signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
      });
      if (!response.ok) {
        log(`[account-deletion] endpoint unavailable (${response.status}); will retry`);
      } else {
        const result = await response.json() as { processed?: boolean; complete?: boolean };
        if (result.processed) log(`[account-deletion] ${result.complete ? "completed" : "pending; will retry"}`);
      }
    } catch {
      if (!signal.aborted) log("[account-deletion] request interrupted; will retry");
    }
    // One request at a time. Shutdown interrupts both network and idle waits.
    await delay(pollMs, undefined, {signal}).catch(() => undefined);
  }
}
