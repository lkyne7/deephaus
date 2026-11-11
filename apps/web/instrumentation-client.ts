import posthog from "posthog-js";
import { analyticsStorageAllowed } from "@/lib/consent";

// Client-side PostHog bootstrap for Next.js 15.3+. Runs once in the browser
// before the app hydrates; pageviews, session replay, and unhandled
// exceptions are captured automatically.
if (process.env.NEXT_PUBLIC_POSTHOG_KEY) {
  // EU/UK visitors who haven't accepted analytics get in-memory analytics only:
  // no cookies or local storage and no replay. The consent banner upgrades
  // the running client when they accept.
  const storageAllowed = analyticsStorageAllowed();
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
    persistence: storageAllowed ? "localStorage+cookie" : "memory",
    disable_session_recording: !storageAllowed,
    // First-party reverse proxy (see next.config.ts) so ad-blockers don't
    // drop events.
    api_host: "/ingest",
    ui_host: "https://us.posthog.com",
    defaults: "2026-01-30",
    capture_exceptions: true,
    // Cards, deck names, and tokens are on screen throughout the app, so
    // rendered text never leaves the browser, on any screen present or future.
    // Replays still show layout, clicks, and URLs.
    mask_all_text: true,
    session_recording: { maskAllInputs: true, maskTextSelector: "*" },
    // Verbose SDK logging is opt-in: it reports its own transport failures as
    // console errors, which is indistinguishable from an app bug.
    debug: process.env.NEXT_PUBLIC_POSTHOG_DEBUG === "1",
  });
  posthog.register({ release: process.env.NEXT_PUBLIC_RELEASE_ID ?? "development" });
}
