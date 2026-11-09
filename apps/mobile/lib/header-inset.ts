import { HeaderHeightContext } from "expo-router/build/react-navigation/elements";
import { useContext } from "react";
import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Used until the native bar reports its height (it's taller on iOS 26). */
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
  const measured = useContext(HeaderHeightContext);
  if (Platform.OS !== "ios") return 0;
  return measured || insets.top + NAV_BAR_HEIGHT;
}
