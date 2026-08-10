"use client";

import { PowerSyncContext } from "@powersync/react";
import { useEffect, useMemo, type ReactNode } from "react";
import {
  connectPowerSync,
  getPowerSync,
  offlineEnabled,
  teardownPowerSync,
} from "@/lib/offline/db";
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
    connectPowerSync().catch((error) => {
      console.warn("[powersync] connect failed", error);
    });
    const supabase = createClient();
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        teardownPowerSync().catch(() => {});
      } else if (event === "SIGNED_IN") {
        connectPowerSync().catch(() => {});
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  if (!db) return <>{children}</>;
  return <PowerSyncContext.Provider value={db}>{children}</PowerSyncContext.Provider>;
}
