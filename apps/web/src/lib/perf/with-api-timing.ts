import { requestPerfContext } from "@/lib/perf/context";
import { getEventLoopDelayMs } from "@/lib/perf/event-loop";
import { logPerf, memorySnapshotMb } from "@/lib/perf/logger";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = (...args: any[]) => Response | Promise<Response>;

function logRequest(
  routeId: string,
  method: string,
  start: number,
  status: number,
  error?: string,
) {
  const ctx = requestPerfContext.getStore() ?? { dbMs: 0, dbQueries: 0, userId: null };
  const mem = memorySnapshotMb();
  logPerf({
    kind: "api",
    path: routeId,
    method,
    status,
    durationMs: Math.round(performance.now() - start),
    userId: ctx.userId ?? null,
    dbMs: Math.round(ctx.dbMs),
    dbQueries: ctx.dbQueries,
    heapUsedMb: mem.heapUsedMb,
    rssMb: mem.rssMb,
    eventLoopDelayMs: getEventLoopDelayMs(),
    runtime: "nodejs",
    error,
  });
}

/** Wrap a Next.js App Router handler to emit structured perf logs. */
export function withApiTiming<T extends AnyHandler>(handler: T, routeId: string): T {
  const method = routeId.split(" ")[0] ?? "HANDLER";

  const wrapped = (async (...args: Parameters<T>) => {
    const start = performance.now();
    const ctx = { dbMs: 0, dbQueries: 0, userId: null as string | null };
    return requestPerfContext.run(ctx, async () => {
      try {
        const response = await handler(...args);
        logRequest(routeId, method, start, response.status);
        return response;
      } catch (error) {
        logRequest(
          routeId,
          method,
          start,
          500,
          error instanceof Error ? error.message : String(error),
        );
        throw error;
      }
    });
  }) as T;

  return wrapped;
}

/** Log response status after handler returns (for manual use outside withApiTiming). */
export function logApiResponse(routeId: string, method: string, start: number, response: Response) {
  logRequest(routeId, method, start, response.status);
}
