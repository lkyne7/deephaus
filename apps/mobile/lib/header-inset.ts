import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { layout } from "@/lib/theme";

/** Standard UINavigationBar height below the status bar. */
const NAV_BAR_HEIGHT = 44;

/**
 * Height of the transparent iOS navigation bar (status bar + nav bar), for
 * fixed (non-scrolling) content that must start below it. Scrollable screens
 * should prefer `contentInsetAdjustmentBehavior="automatic"` so content can
 * scroll under the glass bar. Returns 0 on Android, where the header is the
 * in-screen PageHeader.
 */
export function useHeaderInset() {
  const insets = useSafeAreaInsets();
  return Platform.OS === "ios" ? insets.top + NAV_BAR_HEIGHT : 0;
}

/**
 * Extra space above the floating iOS tab bar (Liquid Glass). Android's JS
 * tab bar already consumes layout height, so this returns 0 there.
 */
export function useTabBarInset() {
  const insets = useSafeAreaInsets();
  if (Platform.OS !== "ios") return 0;
  return insets.bottom + layout.floatingTabBarHeight + layout.floatingGlassInset;
}
