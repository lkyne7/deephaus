import { describe, it, expect } from "vitest";
import { runReminderDispatchWorker } from "./reminder-dispatch-worker.js";

describe("reminder dispatch loop", () => {
  it("calls the dispatcher one request at a time and logs only what happened", async () => {
    const stop = new AbortController();
    let calls = 0, active = 0, maximum = 0;
    const logs: string[] = [];
    await runReminderDispatchWorker({
      appBaseUrl: "https://staging.example", workerSecret: "private", signal: stop.signal, pollMs: 1,
      log: message => logs.push(message),
      fetcher: async (url, options) => {
        expect(url).toBe("https://staging.example/api/internal/notifications/dispatch");
        expect(options?.method).toBe("POST");
        expect(options?.headers).toEqual({Authorization: "Bearer private"});
        maximum = Math.max(maximum, ++active);
        await new Promise(resolve => setTimeout(resolve, 5));
        active--;
        calls++;
        if (calls <= 2) return new Response(null, {status: 503});
        if (calls === 3) return Response.json({checked: 4, sent: 0, failed: 0});
        if (calls === 4) return Response.json({checked: 4, sent: 2, failed: 1});
        stop.abort();
        return Response.json({checked: 0, sent: 0, failed: 0});
      },
    });
    expect(calls).toBe(5);
    expect(maximum).toBe(1);
    // Two failed calls are one line; a quiet pass says nothing.
    expect(logs).toEqual([
      "[reminders] endpoint unavailable (503); will retry",
      "[reminders] sent 2, 1 failed",
    ]);
    expect(logs.join(" ")).not.toContain("private");
  });

  it("cancels a hung request on shutdown", async () => {
    const stop = new AbortController();
    const running = runReminderDispatchWorker({
      appBaseUrl: "https://staging.example", workerSecret: "private", signal: stop.signal,
      log: () => undefined,
      fetcher: async (_url, options) => new Promise((_resolve, reject) => {
        options!.signal!.addEventListener("abort", () => reject(new Error("aborted")), {once: true});
        stop.abort();
      }),
    });
    await running;
    expect(stop.signal.aborted).toBe(true);
  });
});
