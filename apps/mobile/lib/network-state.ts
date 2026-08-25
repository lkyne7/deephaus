import {
  addNetworkStateListener,
  getNetworkStateAsync,
  type NetworkState,
} from "expo-network";

// Offline routing consults connectivity on every read/write. A native
// round-trip per request adds up, so keep one listener-maintained snapshot
// and only pay for the async fetch until the first event arrives.
let snapshot: NetworkState | null = null;
let listening = false;

function ensureListener(): void {
  if (listening) return;
  listening = true;
  addNetworkStateListener((state) => {
    snapshot = state;
  });
}

export async function getCachedNetworkState(): Promise<NetworkState> {
  ensureListener();
  if (snapshot) return snapshot;
  snapshot = await getNetworkStateAsync();
  return snapshot;
}
