import { isFirstSignIn, signupMethod } from "@deephaus/shared";
import type { User } from "@supabase/supabase-js";
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

/**
 * Sends a server-side exception to PostHog error tracking. Never throws:
 * reporting must not turn a handled failure into a second one.
 */
export async function captureServerException(
  error: unknown,
  properties: Record<string, unknown> = {},
  distinctId?: string,
): Promise<void> {
  const posthog = getPostHogServer();
  if (!posthog) return;
  try {
    await posthog.captureExceptionImmediate(error, distinctId ?? "server", {
      release: process.env.NEXT_PUBLIC_RELEASE_ID ?? "development",
      surface: "server",
      ...properties,
    });
  } catch {
    // Reporting is best effort.
  }
}

/**
 * Records `user_signed_up` when the auth callback completes an account's first
 * sign-in. OAuth and email-confirmation signups only ever finish here, so the
 * signup form cannot see them.
 */
export async function captureFirstSignIn(user: User | null): Promise<void> {
  if (!user || !isFirstSignIn(user)) return;
  const posthog = getPostHogServer();
  if (!posthog) return;
  posthog.capture({
    distinctId: user.id,
    event: "user_signed_up",
    properties: {
      method: signupMethod(user),
      release: process.env.NEXT_PUBLIC_RELEASE_ID ?? "development",
    },
  });
  await posthog.flush().catch(() => undefined);
}
