type PerfLogEntry = {
  kind: "api" | "middleware" | "event_loop";
  path?: string;
  method?: string;
  status?: number;
  durationMs: number;
  userId?: string | null;
  dbMs?: number;
  dbQueries?: number;
  heapUsedMb?: number;
  rssMb?: number;
  eventLoopDelayMs?: number;
  runtime?: "nodejs" | "edge";
  error?: string;
};

const ENABLED =
  process.env.PERF_LOG === "1" ||
  process.env.NODE_ENV === "development" ||
  process.env.VERCEL_ENV === "preview";

export function isPerfLoggingEnabled() {
  return ENABLED;
}

export function logPerf(entry: PerfLogEntry) {
  if (!ENABLED) return;
  console.info("[perf]", JSON.stringify({ ts: new Date().toISOString(), ...entry }));
}

export function memorySnapshotMb() {
  if (typeof process === "undefined" || !process.memoryUsage) {
    return { heapUsedMb: undefined, rssMb: undefined };
  }
  const mem = process.memoryUsage();
  return {
    heapUsedMb: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
    rssMb: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
  };
}
