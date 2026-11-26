import { Platform } from "react-native";
import PostHog from "posthog-react-native";

const apiKey = process.env.EXPO_PUBLIC_POSTHOG_API_KEY ?? "";
const host = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

export const posthogEnabled = apiKey.length > 0;

/**
 * Shared PostHog client. Events queue locally and flush in batches, so
 * captures are safe to call while offline — a good match for the app's
 * offline-first data layer.
 */
export const posthog = new PostHog(apiKey || "placeholder", {
  host,
  disabled: !posthogEnabled,
  captureAppLifecycleEvents: true,
});

if (__DEV__ && posthogEnabled) {
  posthog.debug(true);
}

/**
 * Properties sent with every event. `platform` shares the web client's property
 * (web, desktop, ios, android). reset() drops them, so re-register after it.
 */
export const analyticsContext = {
  release: process.env.EXPO_PUBLIC_RELEASE_ID ?? "development",
  platform: Platform.OS,
};

posthog.register(analyticsContext);
