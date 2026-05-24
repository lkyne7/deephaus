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
);

export const API_BASE_URL =
  extra?.apiBaseUrl ?? process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:3000";
