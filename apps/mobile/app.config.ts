import type { ExpoConfig } from "expo/config";

import appJson from "./app.json";

const base = appJson.expo as unknown as ExpoConfig;

export default (): ExpoConfig => ({
  ...base,
  extra: {
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:3000",
  },
});
