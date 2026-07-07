import { createDeepHausClient } from "@deephaus/api-client";
import { loadStoredSession } from "./auth-session";
import { API_BASE_URL } from "./config";

export const api = createDeepHausClient({
  baseUrl: API_BASE_URL,
  getAccessToken: async () => {
    const session = await loadStoredSession();
    return session?.access_token ?? null;
  },
});
