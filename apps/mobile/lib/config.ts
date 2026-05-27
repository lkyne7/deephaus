import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import Constants from "expo-constants";

const extra = Constants.expoConfig?.extra as {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  apiBaseUrl?: string;
};

export const supabase = createClient(
  extra?.supabaseUrl ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? "",
  extra?.supabaseAnonKey ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "",
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  },
);

export const API_BASE_URL =
  extra?.apiBaseUrl ?? process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:3000";
