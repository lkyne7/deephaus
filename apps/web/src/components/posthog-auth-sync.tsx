"use client";

import posthog from "posthog-js";
import { useEffect } from "react";
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
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      const user = session?.user;
      if (user) {
        // Supabase re-emits SIGNED_IN on every session restore, so sign-in
        // events are captured in the auth form instead; identify is idempotent.
        posthog.identify(user.id, {
          email: user.email,
          name:
            (user.user_metadata?.full_name as string | undefined) ??
            (user.user_metadata?.name as string | undefined),
        });
      } else if (event === "SIGNED_OUT") {
        posthog.capture("user_signed_out");
        posthog.reset();
      }
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  return null;
}
