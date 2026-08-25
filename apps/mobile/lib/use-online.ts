import { useNetworkState } from "expo-network";

/**
 * Connectivity signal for gating online-only features (AI generation,
 * billing, community, leaderboard). Unknown reachability stays disabled until
 * Expo confirms internet access, avoiding failed requests during cold start.
 */
export function useOnline(): boolean {
  const state = useNetworkState();
  return state.isConnected === true && state.isInternetReachable === true;
}
