import { PowerSyncContext } from "@powersync/react";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  connectPowerSync,
  getPowerSync,
  offlineEnabled,
  teardownPowerSync,
} from "@/lib/powersync";

/**
 * Provides the local PowerSync database to the app and manages its sync
 * connection lifecycle: connect once a session exists, disconnect + clear
 * local data on sign-out.
 */
export function PowerSyncProvider({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const db = useMemo(() => (offlineEnabled ? getPowerSync() : null), []);
  const hadSession = useRef(false);

  useEffect(() => {
    if (!offlineEnabled || loading) return;
    if (session) {
      hadSession.current = true;
      connectPowerSync().catch((error) => {
        console.warn("[powersync] connect failed", error);
      });
    } else if (hadSession.current) {
      hadSession.current = false;
      teardownPowerSync().catch(() => {});
    }
  }, [session, loading]);

  if (!db) return <>{children}</>;
  return <PowerSyncContext.Provider value={db}>{children}</PowerSyncContext.Provider>;
}
