import { PowerSyncContext } from "@powersync/react";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { AppState } from "react-native";
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
    const userId = session?.user.id;
    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (!userId) return;
      void connectPowerSync(userId).catch((error) => {
        console.warn("[powersync] connect failed", error);
        if (active) {
          retryTimer = setTimeout(connect, 5_000);
        }
      });
    };

    if (userId) {
      hadSession.current = true;
      connect();
    } else if (hadSession.current) {
      hadSession.current = false;
      void teardownPowerSync().catch((error) => {
        console.warn("[powersync] teardown failed", error);
      });
    }

    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") connect();
    });

    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
      appStateSubscription.remove();
    };
  }, [session?.user.id, loading]);

  if (!db) return <>{children}</>;
  return <PowerSyncContext.Provider value={db}>{children}</PowerSyncContext.Provider>;
}
