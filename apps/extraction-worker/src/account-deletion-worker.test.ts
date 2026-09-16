import { describe, it, expect } from "vitest";
import { runAccountDeletionWorker } from "./account-deletion-worker.js";

describe("independent account deletion worker", () => {
  it("retries failures without overlapping requests, then stops after completion", async () => {
    const stop = new AbortController();
    let calls = 0, active = 0, maximum = 0;
    const logs: string[] = [];
    await runAccountDeletionWorker({
      appBaseUrl: "https://staging.example", workerSecret: "private", signal: stop.signal, pollMs: 1,
      log: message => logs.push(message),
      fetcher: async (_url, options) => {
        expect(options?.headers).toEqual({Authorization: "Bearer private"});
        maximum = Math.max(maximum, ++active);
        await new Promise(resolve => setTimeout(resolve, 5));
        active--;
        if (++calls === 1) return new Response(null, {status: 503});
        if (calls === 2) throw new Error("connection reset");
        stop.abort();
        return Response.json({processed: true, complete: true});
      },
    });
    expect(calls).toBe(3);
    expect(maximum).toBe(1);
    expect(logs).toHaveLength(3);
    expect(logs.join(" ")).not.toContain("private");
  });

  it("cancels a hung request on shutdown", async () => {
    const stop = new AbortController();
    const running = runAccountDeletionWorker({
      appBaseUrl: "https://staging.example", workerSecret: "private", signal: stop.signal,
      fetcher: async (_url, options) => new Promise((_resolve, reject) => {
        options!.signal!.addEventListener("abort", () => reject(new Error("aborted")), {once: true});
        stop.abort();
      }),
    });
    await running;
    expect(stop.signal.aborted).toBe(true);
  });
});
