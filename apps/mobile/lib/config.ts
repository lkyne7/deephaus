import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import Constants from "expo-constants";

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

const supabaseUrl = readConfigValue(
  process.env.EXPO_PUBLIC_SUPABASE_URL,
  extra?.supabaseUrl,
);
const supabaseAnonKey = readConfigValue(
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  extra?.supabaseAnonKey,
);

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export const API_BASE_URL =
  readConfigValue(process.env.EXPO_PUBLIC_API_BASE_URL, extra?.apiBaseUrl) ||
  "http://localhost:3000";
