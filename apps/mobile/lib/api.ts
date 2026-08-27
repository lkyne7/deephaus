import { createDeepHausClient } from "@deephaus/api-client";
import { loadStoredSession } from "./auth-session";
import { API_BASE_URL } from "./config";
import { markPowerSyncServerWrite } from "./powersync";

export const api = createDeepHausClient({
  baseUrl: API_BASE_URL,
  getAccessToken: async () => {
    const session = await loadStoredSession();
    return session?.access_token ?? null;
  },
  // Every successful server mutation (deck rename/delete, cram lifecycle,
  // profile settings, ...) invalidates the local replica until the next sync
  // checkpoint; otherwise a follow-up local write could run on stale rows.
  onMutationSuccess: markPowerSyncServerWrite,
});
