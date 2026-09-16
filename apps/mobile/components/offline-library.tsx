import { posthog } from "@/lib/posthog";
import { useEffect, useRef, useState } from "react";
import { AppState, Pressable, Text, View } from "react-native";
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
export function OfflineLibrary() {
  const { user } = useAuth();
  return offlineEnabled && mediaDownloadsEnabled && user ? (
    <AccountLibrary key={user.id} userId={user.id} />
  ) : null;
}
function AccountLibrary({ userId }: { userId: string }) {
  const status = useStatus(),
    { colors } = useTheme();
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
  if (!state) return null;
  return (
    <View
      style={{ padding: 10, backgroundColor: colors.bgSurface }}
      accessibilityLabel="Offline library"
    >
      <Text
        accessibilityLiveRegion="polite"
        style={{ color: colors.fgPrimary, fontSize: 12 }}
      >
        {state.state} · {state.downloaded}/{state.total} media ·{" "}
        {(state.bytes / 1048576).toFixed(1)} MB ·{" "}
        {Number(pending?.[0]?.count ?? 0)} uploads pending
        {status.uploadError ? " · Sign in or retry sync" : ""}
      </Text>
      {state.error && (
        <Text
          accessibilityRole="alert"
          style={{ color: colors.fgPrimary, fontSize: 12 }}
        >
          {state.error}
        </Text>
      )}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 }}>
        <Pressable
          accessibilityRole="button"
          onPress={() => setPaused(!paused)}
          style={{ minHeight: 44, justifyContent: "center" }}
        >
          <Text style={{ color: colors.brand600 }}>
            {paused ? "Resume" : "Pause"}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            const next = !cellular;
            setCellular(next);
            void AsyncStorage.setItem(
              `deephaus:media-cellular:${userId}`,
              String(next),
            );
          }}
          style={{ minHeight: 44, justifyContent: "center" }}
        >
          <Text style={{ color: colors.brand600 }}>
            {cellular ? "Use Wi-Fi only" : "Allow cellular"}
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            void manager.current
              ?.verify()
              .then(() => manager.current?.run(true));
          }}
          style={{ minHeight: 44, justifyContent: "center" }}
        >
          <Text style={{ color: colors.brand600 }}>Retry</Text>
        </Pressable>
      </View>
    </View>
  );
}
