let latestDelayMs = 0;
let monitorStarted = false;

/** Sample event-loop lag using a 1s interval (Node.js only). */
export function startEventLoopMonitor() {
  if (monitorStarted || typeof process === "undefined") return;
  monitorStarted = true;

  let last = performance.now();
  setInterval(() => {
    const now = performance.now();
    latestDelayMs = Math.max(0, now - last - 1000);
    last = now;
    if (latestDelayMs > 200 && process.env.PERF_LOG === "1") {
      console.warn("[perf:event_loop]", JSON.stringify({ delayMs: Math.round(latestDelayMs) }));
    }
  }, 1000).unref?.();
}

export function getEventLoopDelayMs() {
  return Math.round(latestDelayMs);
}
