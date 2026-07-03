export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startEventLoopMonitor } = await import("@/lib/perf/event-loop");
    startEventLoopMonitor();
  }
}
