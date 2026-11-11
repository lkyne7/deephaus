import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startEventLoopMonitor } = await import("@/lib/perf/event-loop");
    startEventLoopMonitor();
  }
}

// Errors that escape a page, layout, server action or route handler. Route
// handlers wrapped in withApiTiming catch their own errors and report them
// there, so they never reach this hook.
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { captureServerException } = await import("@/lib/posthog-server");
  await captureServerException(error, {
    path: request.path.split("?")[0],
    method: request.method,
    router_kind: context.routerKind,
    route_path: context.routePath,
    route_type: context.routeType,
  });
};
