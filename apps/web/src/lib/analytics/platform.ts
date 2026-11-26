export type AnalyticsPlatform = "web" | "desktop";

/**
 * Which surface the web bundle is running in. The Electron shell exposes
 * `window.deephausDesktop` from its preload script (apps/desktop/src/preload).
 */
export function analyticsPlatform(): AnalyticsPlatform {
  if (typeof window === "undefined") return "web";
  return "deephausDesktop" in window ? "desktop" : "web";
}

/** Properties sent with every event; posthog.reset() drops them, so re-register after it. */
export function analyticsContext() {
  return {
    release: process.env.NEXT_PUBLIC_RELEASE_ID ?? "development",
    platform: analyticsPlatform(),
  };
}
