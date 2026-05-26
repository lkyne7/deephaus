import { addDbTiming } from "@/lib/perf/context";

/** Wrap a Supabase (or other async) call to accumulate DB timing in request context. */
export async function timedQuery<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    addDbTiming(performance.now() - start);
    if (process.env.PERF_LOG === "1" && process.env.NODE_ENV === "development") {
      console.debug(`[perf:db] ${label} ${Math.round(performance.now() - start)}ms`);
    }
  }
}
