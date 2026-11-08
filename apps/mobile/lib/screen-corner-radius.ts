import { Dimensions, Platform } from "react-native";

/**
 * Corner radius of the iPhone's display, in points, so a card can follow
 * the screen's own curve (as the page does when the sidebar opens).
 *
 * UIKit only exposes this through a private UIScreen key, which risks App
 * Store review, so it's looked up by screen size instead. Sizes are in
 * portrait points; values are the published radii for each family.
 */
const RADII: Record<string, number> = {
  "375x812": 39, // X, XS, 11 Pro
  "414x896": 41.5, // XR, 11, XS Max, 11 Pro Max
  "360x780": 44, // 12 mini, 13 mini
  "390x844": 47.33, // 12, 12 Pro, 13, 13 Pro, 14, 16e
  "428x926": 53.33, // 12 Pro Max, 13 Pro Max, 14 Plus
  "393x852": 55, // 14 Pro, 15, 15 Pro, 16
  "430x932": 55, // 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus
  "402x874": 62, // 16 Pro, 17, 17 Pro
  "420x912": 62, // Air (matches a native pop measured on the simulator)
  "440x956": 62, // 16 Pro Max, 17 Pro Max
};

// Newer, unlisted phones are likelier to match the latest curve.
const FALLBACK = 55;

export function screenCornerRadius(): number {
  if (Platform.OS !== "ios") return 28;
  const { width, height } = Dimensions.get("screen");
  const key = `${Math.round(Math.min(width, height))}x${Math.round(Math.max(width, height))}`;
  // Home-button iPhones and iPads (other sizes) get the fallback; on a
  // square-cornered screen it still reads as a card.
  return RADII[key] ?? FALLBACK;
}
