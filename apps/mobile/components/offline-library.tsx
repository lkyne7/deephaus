import { posthog } from "@/lib/posthog";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AppState, Switch, View } from "react-native";
import { useStatus, useQuery } from "@powersync/react";
import * as Network from "expo-network";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLibraryMedia } from "@deephaus/local-db";
import {
  OfflineMediaLibrary,
  setActiveMediaVerifier,
  setActiveMedia,
  type MediaReadiness,
} from "@deephaus/shared";
import { useAuth } from "@/lib/auth-context";
import {
  getPowerSync,
  ensurePowerSyncAccountReady,
  offlineEnabled,
} from "@/lib/powersync";
import { mediaDownloadsEnabled, nativeMediaStorage } from "@/lib/media-storage";
import { useTheme } from "@/lib/theme-context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UIText } from "@/components/ui/text";
type LibraryControls = {
  state: MediaReadiness | null;
  pending: number;
  uploadError: boolean;
  paused: boolean;
  cellular: boolean;
  togglePaused: () => void;
  setCellular: (enabled: boolean) => void;
  retry: () => void;
};
const LibraryContext = createContext<LibraryControls | null>(null);

export function OfflineLibraryProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return offlineEnabled && mediaDownloadsEnabled && user ? (
    <AccountLibrary key={user.id} userId={user.id}>{children}</AccountLibrary>
  ) : <>{children}</>;
}
function AccountLibrary({ userId, children }: { userId: string; children: ReactNode }) {
  const status = useStatus();
  const { data: pending } = useQuery<{ count: number }>(
    "SELECT COUNT(*) count FROM ps_crud",
  );
  const [state, setState] = useState<MediaReadiness | null>(null),
    [cellular, setCellular] = useState(false),
    [paused, setPaused] = useState(false);
  const manager = useRef<OfflineMediaLibrary | null>(null),
    policy = useRef({ cellular, paused });
  policy.current = { cellular, paused };
  const refresh = useRef<() => Promise<void>>(async () => {});
  const lastSyncedAt = status.lastSyncedAt?.getTime();
  useEffect(() => {
    void AsyncStorage.getItem(`deephaus:media-cellular:${userId}`).then((v) =>
      setCellular(v === "true"),
    );
  }, [userId]);
  useEffect(() => {
    let active = true,
      busy = false,
      refreshRequested = false;
    const library = new OfflineMediaLibrary(
      nativeMediaStorage(userId),
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
        await ensurePowerSyncAccountReady(userId);
        const network = await Network.getNetworkStateAsync();
        library.setPaused(
          policy.current.paused ||
            network.isConnected === false ||
            network.isInternetReachable === false ||
            (!policy.current.cellular &&
              network.type !== Network.NetworkStateType.WIFI),
        );
        await library.verify();
        await library.reconcile(
          await getLibraryMedia(getPowerSync(), userId),
          !!getPowerSync().currentStatus.hasSynced &&
            (network.isConnected === false ||
              network.isInternetReachable === false ||
              !getPowerSync().currentStatus.dataFlowStatus.downloading),
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
                    "Could not check device storage. Retry when connected.",
                }
              : null,
          );
      } finally {
        busy = false;
        if (active && refreshRequested) void update();
      }
    };
    const networkListener = Network.addNetworkStateListener((network) => {
      const pause =
        AppState.currentState !== "active" ||
        policy.current.paused ||
        network.isConnected === false ||
        network.isInternetReachable === false ||
        (!policy.current.cellular &&
          network.type !== Network.NetworkStateType.WIFI);
      library.setPaused(pause);
      void update();
    });
    refresh.current = update;
    void library.initialize().then(update);
    const timer = setInterval(() => {
      void update();
    }, 60_000);
    const listener = AppState.addEventListener("change", (s) => {
      if (s === "active") void update();
      else library.setPaused(true);
    });
    return () => {
      active = false;
      library.stop();
      manager.current = null;
      clearInterval(timer);
      listener.remove();
      networkListener.remove();
      setActiveMediaVerifier(null);
      setActiveMedia([]);
    };
  }, [userId]);
  useEffect(() => {
    void refresh.current();
  }, [
    cellular,
    paused,
    status.hasSynced,
    lastSyncedAt,
    status.dataFlowStatus.downloading,
  ]);
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
      paused, cellular, togglePaused: () => setPaused(value => !value),
      setCellular: (enabled) => {
        setCellular(enabled);
        void AsyncStorage.setItem(`deephaus:media-cellular:${userId}`, String(enabled));
      },
      retry: () => { void refresh.current().then(() => manager.current?.run(true)); },
    }}>
      {children}
    </LibraryContext.Provider>
  );
}

export function OfflineLibrarySettings() {
  const library = useContext(LibraryContext);
  const { colors } = useTheme();
  if (!library) return null;
  const { state, pending, uploadError, paused, cellular, togglePaused, setCellular, retry } = library;
  const label = paused ? "Downloads paused" : state?.state === "Ready offline" ? "Downloaded" : state?.state ?? "Checking downloads…";
  return (
    <Card padding={16} style={{ gap: 12 }}>
      <UIText variant="subtitle">Offline downloads</UIText>
      <UIText variant="muted">Keep card images on this device for studying without a connection.</UIText>
      <View accessibilityLabel="Offline library" accessibilityLiveRegion="polite" style={{ gap: 4 }}>
        <UIText>{label}</UIText>
        <UIText variant="muted">{state?.downloaded ?? 0}/{state?.total ?? 0} images · {((state?.bytes ?? 0) / 1048576).toFixed(1)} MB on this device</UIText>
        <UIText variant="muted">{pending === 0 ? "All changes synced" : `${pending} changes waiting to sync`}</UIText>
      </View>
      {state?.error && <UIText accessibilityRole="alert">{state.error}</UIText>}
      {uploadError && <UIText accessibilityRole="alert">Your changes are saved on this device. Sign in again to sync.</UIText>}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <UIText>Use cellular data</UIText>
          <UIText variant="muted">{cellular ? "Downloads can use Wi-Fi or cellular data." : "Downloads wait for Wi-Fi."}</UIText>
        </View>
        <Switch accessibilityLabel="Use cellular data for downloads" value={cellular} onValueChange={setCellular} trackColor={{ true: colors.brand600 }} />
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Button variant="secondary" label={paused ? "Resume downloads" : "Pause downloads"} onPress={togglePaused} disabled={!state} />
        <Button variant="secondary" label="Check downloads" onPress={retry} disabled={!state} />
      </View>
    </Card>
  );
}
