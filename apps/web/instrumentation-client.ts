import posthog from "posthog-js";

// Client-side PostHog bootstrap for Next.js 15.3+. Runs once in the browser
// before the app hydrates; pageviews, session replay, and unhandled
// exceptions are captured automatically.
if (process.env.NEXT_PUBLIC_POSTHOG_KEY) {
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
    // First-party reverse proxy (see next.config.ts) so ad-blockers don't
    // drop events.
    api_host: "/ingest",
    ui_host: "https://us.posthog.com",
    defaults: "2026-01-30",
    capture_exceptions: true,
    // Verbose SDK logging is opt-in: it reports its own transport failures as
    // console errors, which is indistinguishable from an app bug.
    debug: process.env.NEXT_PUBLIC_POSTHOG_DEBUG === "1",
  });
}
