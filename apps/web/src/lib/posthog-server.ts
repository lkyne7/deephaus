import { PostHog } from "posthog-node";

let client: PostHog | null = null;

/**
 * Server-side PostHog client for events that never happen in a browser
 * (webhooks, background jobs). Events are flushed immediately because
 * serverless invocations may end right after the handler returns.
 */
export function getPostHogServer(): PostHog | null {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return null;
  if (!client) {
    client = new PostHog(key, {
      host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
      flushAt: 1,
      flushInterval: 0,
    });
  }
  return client;
}
