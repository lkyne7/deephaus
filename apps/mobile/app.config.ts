import type { ExpoConfig } from "expo/config";

import appJson from "./app.json";

const base = appJson.expo as unknown as ExpoConfig;

export default (): ExpoConfig => ({
  ...base,
  plugins: [...(base.plugins ?? []), "expo-web-browser", "expo-secure-store"],
  extra: {
    ...(base.extra ?? {}),
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:3000",
    powersyncUrl: process.env.EXPO_PUBLIC_POWERSYNC_URL,
    revenueCatIosApiKey: process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY,
    revenueCatAndroidApiKey: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY,
  },
});
