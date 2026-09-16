"use client";
import { getOfflineUserId } from "@/lib/offline/identity";
import posthog from "posthog-js";

import { useEffect, useRef, useState } from "react";
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
export function OfflineLibrary() {
  return offlineEnabled && mediaDownloadsEnabled ? <Library /> : null;
}
function Library() {
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
  return userId ? <AccountLibrary key={userId} userId={userId} /> : null;
}
function AccountLibrary({ userId }: { userId: string }) {
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
  if (!state) return <div role="status">Checking offline library…</div>;
  const label =
    process.env.NODE_ENV === "development" && state.state === "Ready offline"
      ? "Downloaded · offline app shell requires a production build"
      : state.state;
  return (
    <aside
      aria-label="Offline library"
      style={{
        padding: "8px 16px",
        fontSize: 12,
        borderBottom: "1px solid var(--border-secondary,#ddd)",
      }}
    >
      <span role="status">
        {label} · {state.downloaded}/{state.total} media ·{" "}
        {(state.bytes / 1048576).toFixed(1)} MB ·{" "}
        {Number(pending?.[0]?.count ?? 0)} uploads pending
        {status.uploadError ? " · Uploads need attention" : ""}
      </span>
      {status.uploadError && (
        <a href="/login">Sign in again to sync saved work</a>
      )}
      {state.error && <span role="alert"> · {state.error}</span>}{" "}
      <button onClick={() => setPaused(!paused)}>
        {paused ? "Resume" : "Pause downloads"}
      </button>{" "}
      <button
        onClick={() => {
          void manager.current?.verify().then(() => manager.current?.run(true));
        }}
      >
        Retry / verify
      </button>
    </aside>
  );
}
