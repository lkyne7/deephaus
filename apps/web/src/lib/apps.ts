/**
 * Where each DeepHaus app lives, for the public site and onboarding.
 *
 * The iPhone app is not on the App Store yet. When the production listing
 * (App Store Connect id 6805631471, com.deephaus.app) goes live, set
 * `available` to true and every "Coming soon" label becomes a store link.
 */
export const IOS_APP = {
  available: false,
  href: "https://apps.apple.com/app/id6805631471",
} as const;

/** Public page with desktop downloads and the other apps. */
export const DOWNLOAD_PAGE = "/download";

/** Setup instructions for ChatGPT, Claude and Cursor. */
export const INTEGRATIONS_PAGE = "/integrations";
