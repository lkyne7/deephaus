import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";
import { AppState, LogBox } from "react-native";

// Supabase may log once while clearing a revoked refresh token from AsyncStorage.
LogBox.ignoreLogs(["Invalid Refresh Token", "Refresh Token Not Found"]);

const extra = Constants.expoConfig?.extra as {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  apiBaseUrl?: string;
};

function readConfigValue(...values: (string | undefined)[]): string {
  for (const value of values) {
    if (!value || value.startsWith("${")) continue;
    return value;
  }
  return "";
}

export const SUPABASE_URL = readConfigValue(
  process.env.EXPO_PUBLIC_SUPABASE_URL,
  extra?.supabaseUrl,
);
const supabaseAnonKey = readConfigValue(
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  extra?.supabaseAnonKey,
);

const authStorage = {
  async getItem(key: string): Promise<string | null> {
    const secured = await SecureStore.getItemAsync(key);
    if (secured) return secured;

    // One-time migration for existing installs that persisted the Supabase
    // session in AsyncStorage.
    const legacy = await AsyncStorage.getItem(key);
    if (legacy) {
      await SecureStore.setItemAsync(key, legacy);
      await AsyncStorage.removeItem(key);
    }
    return legacy;
  },
  async setItem(key: string, value: string): Promise<void> {
    await SecureStore.setItemAsync(key, value);
    await AsyncStorage.removeItem(key);
  },
  async removeItem(key: string): Promise<void> {
    await Promise.all([
      SecureStore.deleteItemAsync(key),
      AsyncStorage.removeItem(key),
    ]);
  },
};

export const supabase = createClient(SUPABASE_URL, supabaseAnonKey, {
  auth: {
    storage: authStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// React Native has no reliable background timers, so Supabase's refresh loop
// must be driven by app state (per the Supabase RN docs). Without this the
// access token routinely expires while backgrounded and every consumer that
// reconnects on foreground (PowerSync sync streams, API calls) races the lazy
// refresh with a dead token.
AppState.addEventListener("change", (state) => {
  if (state === "active") {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});
if (AppState.currentState === "active") {
  supabase.auth.startAutoRefresh();
}

const configuredApiBaseUrl = readConfigValue(
  process.env.EXPO_PUBLIC_API_BASE_URL,
  extra?.apiBaseUrl,
);
const isLoopbackApiUrl = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::|\/|$)/i.test(
  configuredApiBaseUrl,
);
const isPhysicalExpoGo = Constants.appOwnership === "expo" && Device.isDevice;

// A loopback URL is valid for the simulator during development, but it points
// back to a physical phone in both Release builds and Expo Go. Use production
// there unless a reachable non-loopback development URL is explicitly set.
export const API_BASE_URL =
  ((!__DEV__ || isPhysicalExpoGo) && isLoopbackApiUrl)
    ? "https://www.deephaus.ai"
    : configuredApiBaseUrl || (__DEV__ ? "http://localhost:3000" : "https://www.deephaus.ai");
