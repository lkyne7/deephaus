import type { NetworkState } from "expo-network";
import type { AppStateStatus } from "react-native";

export function shouldPauseMediaDownloads(
  appState: AppStateStatus,
  policy: { paused: boolean; cellular: boolean },
  network: NetworkState,
): boolean {
  return appState !== "active" || policy.paused ||
    network.isConnected === false || network.isInternetReachable === false ||
    (!policy.cellular && network.type !== "WIFI");
}
