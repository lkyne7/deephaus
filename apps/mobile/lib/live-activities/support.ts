import { Platform } from "react-native";

/**
 * Live Activities exist on iOS 16.2+ only. ActivityKit also throws when the user has
 * turned Live Activities off for the app, so every call site treats failures as
 * "no activity" rather than an error worth surfacing.
 */
export const liveActivitiesSupported = Platform.OS === "ios";

export function warnLiveActivity(action: string, error: unknown) {
  if (__DEV__) {
    console.warn(`[live-activity] ${action} failed:`, error instanceof Error ? error.message : error);
  }
}
