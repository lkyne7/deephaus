import { useNetworkState } from "expo-network";

/**
 * Connectivity signal for gating online-only features (AI generation,
 * billing, community, leaderboard). Unknown state (cold start, before the
 * first NetInfo probe resolves) counts as online, matching the data-routing
 * layer: prefer the API and let a failed request fall back or surface an
 * error, instead of flashing offline UI on every launch.
 */
export function useOnline(): boolean {
  const state = useNetworkState();
  return state.isConnected !== false && state.isInternetReachable !== false;
}
