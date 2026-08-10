import { useNetworkState } from "expo-network";

/**
 * Connectivity signal for gating online-only features (AI generation,
 * billing, community, leaderboard). Treats unknown state as online so the UI
 * doesn't flash offline notices while the first network check resolves.
 */
export function useOnline(): boolean {
  const state = useNetworkState();
  return state.isInternetReachable !== false && state.isConnected !== false;
}
