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
