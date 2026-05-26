import { createDeepHausClient } from "@deephaus/api-client";
import { API_BASE_URL, supabase } from "./config";

export const api = createDeepHausClient({
  baseUrl: API_BASE_URL,
  getAccessToken: async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  },
});
