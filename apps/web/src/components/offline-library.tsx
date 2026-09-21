"use client";
import { getOfflineUserId } from "@/lib/offline/identity";
import posthog from "posthog-js";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useStatus } from "@powersync/react";
import { getLibraryMedia } from "@deephaus/local-db";
import {
  OfflineMediaLibrary,
  setActiveMediaVerifier,
  setActiveMedia,
  type MediaReadiness,
} from "@deephaus/shared";
import {
  browserMediaStorage,
  clearActiveMediaCache,
  mediaDownloadsEnabled,
} from "@/lib/offline/media";
import {
  getPowerSync,
  ensurePowerSyncAccountReady,
  offlineEnabled,
} from "@/lib/offline/db";
import { createClient } from "@/lib/supabase/client";
import { useOnline } from "@/lib/offline/use-online";
type LibraryControls = {
  state: MediaReadiness | null;
  pending: number;
  uploadError: boolean;
  paused: boolean;
  togglePaused: () => void;
  retry: () => void;
};
const LibraryContext = createContext<LibraryControls | null>(null);
export function useOfflineLibrary() { return useContext(LibraryContext); }

// Own the download lifecycle at app scope; opening settings only displays it.
export function OfflineLibraryProvider({ children }: { children: ReactNode }) {
  return offlineEnabled && mediaDownloadsEnabled ? <Library>{children}</Library> : <>{children}</>;
}
function Library({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(getOfflineUserId);
  useEffect(() => {
    const client = createClient();
    let active = true;
    void client.auth.getSession().then(({ data }) => {
      if (active) setUserId(data.session?.user.id ?? getOfflineUserId());
    });
    const { data } = client.auth.onAuthStateChange((_e, s) =>
      setUserId(s?.user.id ?? getOfflineUserId()),
    );
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);
  return userId ? <AccountLibrary key={userId} userId={userId}>{children}</AccountLibrary> : <>{children}</>;
}
function AccountLibrary({ userId, children }: { userId: string; children: ReactNode }) {
  const status = useStatus(),
    online = useOnline();
  const { data: pending } = useQuery<{ count: number }>(
    "SELECT COUNT(*) count FROM ps_crud",
  );
  const [state, setState] = useState<MediaReadiness | null>(null),
    [paused, setPaused] = useState(false);
  const manager = useRef<OfflineMediaLibrary | null>(null);
  const refresh = useRef<() => Promise<void>>(async () => {});
  const lastSyncedAt = status.lastSyncedAt?.getTime();
  useEffect(() => {
    let active = true,
      busy = false,
      refreshRequested = false;
    const library = new OfflineMediaLibrary(
      browserMediaStorage(userId),
      (next, entries) => {
        if (active) {
          setState(next);
          setActiveMedia(entries);
        }
      },
    );
    manager.current = library;
    setActiveMediaVerifier((urls) => library.verify(urls));
    const update = async () => {
      library.setDataReady(false);
      if (busy) {
        refreshRequested = true;
        return;
      }
      busy = true;
      refreshRequested = false;
      try {
        if (!(await ensurePowerSyncAccountReady()))
          throw new Error("Sign in to verify your library");
        await library.verify();
        await library.reconcile(
          await getLibraryMedia(getPowerSync(), userId),
          !!getPowerSync().currentStatus.hasSynced &&
            (!navigator.onLine || !getPowerSync().currentStatus.dataFlowStatus.downloading),
        );
        await library.run();
      } catch {
        if (active)
          setState((s) =>
            s
              ? {
                  ...s,
                  state: "Needs attention",
                  error:
                    "Could not check the downloaded library. Retry when connected.",
                }
              : null,
          );
      } finally {
        busy = false;
        if (active && refreshRequested) void update();
      }
    };
    refresh.current = update;
    void library.initialize().then(update);
    const timer = setInterval(() => {
      void update();
    }, 60_000);
    const focus = () => {
      void update();
    };
    window.addEventListener("focus", focus);
    return () => {
      active = false;
      library.stop();
      manager.current = null;
      clearInterval(timer);
      window.removeEventListener("focus", focus);
      setActiveMediaVerifier(null);
      setActiveMedia([]);
      clearActiveMediaCache();
    };
  }, [userId]);
  useEffect(() => {
    manager.current?.setPaused(paused || !online);
    if (online && !paused) void manager.current?.run();
  }, [online, paused]);
  useEffect(() => {
    // A disconnected transport may keep "downloading" set while reconnecting.
    // The last completed snapshot remains usable after verifying its files.
    if (online) manager.current?.setDataReady(false);
    if (!online || !status.dataFlowStatus.downloading) void refresh.current();
  }, [online, status.hasSynced, lastSyncedAt, status.dataFlowStatus.downloading]);
  const reportedFailure = useRef(false);
  useEffect(() => {
    const failed = state?.state === "Needs attention";
    if (failed && !reportedFailure.current)
      posthog.capture("offline_download_failed", {
        media_total: state?.total,
        media_downloaded: state?.downloaded,
      });
    reportedFailure.current = failed;
  }, [state]);
  return (
    <LibraryContext.Provider value={{
      state, pending: Number(pending?.[0]?.count ?? 0), uploadError: !!status.uploadError,
      paused, togglePaused: () => setPaused(value => !value),
      retry: () => { void refresh.current().then(() => manager.current?.run(true)); },
    }}>
      {children}
    </LibraryContext.Provider>
  );
}

export function OfflineLibrarySettings() {
  const library = useOfflineLibrary();
  if (!library) return null;
  const { state, paused, pending, uploadError, togglePaused, retry } = library;
  const label = paused ? "Downloads paused" : state?.state === "Ready offline" ? "Downloaded" : state?.state ?? "Checking downloads…";
  return (
    <aside aria-label="Offline library" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <p style={{ margin: 0, color: "var(--fg-tertiary)", font: "400 14px/21px var(--font-sans)" }}>
        Keep card images on this browser for studying without a connection. Downloads continue while you use DeepHaus.
      </p>
      <div style={{ padding: 20, border: "1px solid var(--border-secondary)", borderRadius: 8, background: "var(--bg-surface-2)" }}>
        <div role="status" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ font: "600 14px/20px var(--font-sans)", color: "var(--fg-primary)" }}>{label}</span>
          <span style={{ font: "400 13px/20px var(--font-sans)", color: "var(--fg-tertiary)" }}>
            {state?.downloaded ?? 0}/{state?.total ?? 0} images · {((state?.bytes ?? 0) / 1048576).toFixed(1)} MB on this browser
          </span>
          <span style={{ font: "400 13px/20px var(--font-sans)", color: "var(--fg-tertiary)" }}>
            {pending === 0 ? "All changes synced" : `${pending} changes waiting to sync`}
          </span>
        </div>
        {state?.error && <p role="alert" style={{ color: "var(--fg-primary)", fontSize: 13 }}>{state.error}</p>}
        {uploadError && <p role="alert" style={{ fontSize: 13 }}>Your changes are saved on this browser. <a href="/login">Sign in again to sync</a>.</p>}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button type="button" className="btn btn-secondary" onClick={togglePaused} disabled={!state}>{paused ? "Resume downloads" : "Pause downloads"}</button>
        <button type="button" className="btn btn-secondary" onClick={retry} disabled={!state}>Check downloads</button>
      </div>
    </aside>
  );
}
