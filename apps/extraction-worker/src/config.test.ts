import { describe, it, expect } from "vitest";
import { setTimeout as delay } from "node:timers/promises";
import { appLoopOptions, type WorkerConfig } from "./config.js";
import { runAccountDeletionWorker } from "./account-deletion-worker.js";
import { runReminderDispatchWorker } from "./reminder-dispatch-worker.js";

// A 1 ms extraction interval makes a leak obvious: a loop that picked it up
// would call the app dozens of times while this test waits.
const config: WorkerConfig = {
  supabaseUrl: "https://db.example",
  serviceKey: "service",
  appBaseUrl: "https://app.example",
  workerSecret: "private",
  pollMs: 1,
};

describe("appLoopOptions", () => {
  it("passes the app address and secret, not the extraction poll interval", () => {
    expect(appLoopOptions(config)).toEqual({ appBaseUrl: "https://app.example", workerSecret: "private" });
  });

  it.each([
    ["account deletion", runAccountDeletionWorker],
    ["reminders", runReminderDispatchWorker],
  ] as const)("the %s loop keeps its own pace instead of the extraction interval", async (_name, run) => {
    const stop = new AbortController();
    let calls = 0;
    const done = run({
      ...appLoopOptions(config),
      signal: stop.signal,
      log: () => {},
      fetcher: async () => {
        calls++;
        return Response.json({ processed: false, checked: 0, sent: 0, failed: 0 });
      },
    });
    await delay(100);
    stop.abort();
    await done;
    expect(calls).toBe(1);
  });
});
