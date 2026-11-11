"use client";

import posthog from "posthog-js";
import { useEffect } from "react";
import { analyticsStorageAllowed, CONSENT_CHANGED_EVENT } from "@/lib/consent";
import { createClient } from "@/lib/supabase/client";

/**
 * Keeps the PostHog person in sync with the Supabase session: identifies the
 * signed-in user (stable Supabase user id as the distinct id) and resets the
 * device back to anonymous on sign-out.
 */
export function PostHogAuthSync() {
  useEffect(() => {
    if (!posthog.__loaded) return;
    const supabase = createClient();
    let currentUser: { id: string; email?: string; user_metadata?: Record<string, unknown> } | null = null;
    const identify = () => {
      const user = currentUser;
      // Without analytics consent (EU/UK), events stay anonymous.
      if (!user || !analyticsStorageAllowed()) return;
      posthog.identify(user.id, {
        email: user.email,
        name:
          (user.user_metadata?.full_name as string | undefined) ??
          (user.user_metadata?.name as string | undefined),
      });
    };
    window.addEventListener(CONSENT_CHANGED_EVENT, identify);
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      const user = session?.user;
      currentUser = user ?? null;
      if (user) {
        // Supabase re-emits SIGNED_IN on every session restore, so sign-in
        // events are captured in the auth form instead; identify is idempotent.
        identify();
      } else if (event === "SIGNED_OUT") {
        posthog.capture("user_signed_out");
        posthog.reset();
      }
    });
    return () => {
      window.removeEventListener(CONSENT_CHANGED_EVENT, identify);
      listener.subscription.unsubscribe();
    };
  }, []);

  return null;
}
