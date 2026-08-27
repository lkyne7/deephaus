import { router, type Href } from "expo-router";

/**
 * Safely leaves a screen even when it was opened from a cold deep link and
 * therefore has no navigation history to pop.
 */
export function goBackOrReplace(fallback: Href) {
  if (router.canGoBack()) {
    router.back();
    return;
  }

  router.replace(fallback);
}
