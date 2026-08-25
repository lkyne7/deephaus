"use client";

import { PowerSyncContext } from "@powersync/react";
import { useEffect, useMemo, type ReactNode } from "react";
import {
  connectPowerSync,
  getPowerSync,
  offlineEnabled,
  teardownPowerSync,
} from "@/lib/offline/db";
import { clearReviewQueueCache } from "@/lib/study/review-cache";
import { createClient } from "@/lib/supabase/client";

/**
 * Provides the local PowerSync database to the app shell and manages the sync
 * connection lifecycle. Rendered inside the authenticated (app) layout, so a
 * session exists on mount; sign-out disconnects and clears local data.
 */
export function PowerSyncProvider({ children }: { children: ReactNode }) {
  const db = useMemo(() => (offlineEnabled ? getPowerSync() : null), []);

  useEffect(() => {
    if (!offlineEnabled) return;
    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      void connectPowerSync().catch((error) => {
        console.warn("[powersync] connect failed", error);
        if (active) retryTimer = setTimeout(connect, 5_000);
      });
    };

    clearReviewQueueCache();
    connect();
    window.addEventListener("online", connect);

    const supabase = createClient();
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        clearReviewQueueCache();
        teardownPowerSync(true).catch(() => {});
      } else if (event === "SIGNED_IN") {
        clearReviewQueueCache();
        connect();
      }
    });

    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
      window.removeEventListener("online", connect);
      data.subscription.unsubscribe();
    };
  }, []);

  if (!db) return <>{children}</>;
  return <PowerSyncContext.Provider value={db}>{children}</PowerSyncContext.Provider>;
}
