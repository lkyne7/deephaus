import { useDrawerProgress } from "expo-router/drawer";
import { useEffect, type ReactNode } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { screenCornerRadius } from "@/lib/screen-corner-radius";
import { useTheme } from "@/lib/theme-context";
import { PAGE_FADE } from "./sidebar-motion";

type Navigation = {
  addListener: (event: "focus", callback: () => void) => () => void;
  isFocused: () => boolean;
};

// The section on screen before the latest focus. A section that regains focus
// because a sheet or session above it closed is the same one, and stays still.
let currentSection: string | null = null;

// UIKit's deceleration curve, so the fade settles like a native transition.
const EASE = Easing.bezier(0.2, 0.9, 0.3, 1);
const DURATION = 280;

// The page takes the screen's corner curve as soon as it leaves the edge
// (invisible at rest, since it matches the display), casts a faint shadow on
// the sidebar, and its content fades toward the surface as it opens.
const OPEN_RADIUS = screenCornerRadius();
const OPEN_SHADOW = 0.06;

/**
 * Wraps each sidebar area. Choosing a new area from the sidebar fades it in
 * as the sidebar closes, and opening the sidebar slides the page off,
 * rounded like the screen and fading, to uncover the sidebar beneath (see
 * sidebar-motion). Runs on the UI thread.
 *
 * Opacity, radius and shadow only, never a transform: each area hosts a
 * native navigation bar and scroll views whose top insets UIKit reads from the
 * safe area. A scene moved by a transform while it lays out gets a smaller
 * top inset, and UIKit doesn't measure it again when the transform ends, so
 * the bar and the content would stay tucked under the status bar. (The
 * drawer's own sideways slide doesn't change the top inset.)
 */
export function SectionScene({
  name,
  navigation,
  children,
}: {
  name: string;
  navigation: Navigation;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  const drawer = useDrawerProgress();
  const fade = useSharedValue(1);

  useEffect(() => {
    // The area open at launch was focused before this listener existed.
    if (currentSection == null && navigation.isFocused()) currentSection = name;
    return navigation.addListener("focus", () => {
      const previous = currentSection;
      currentSection = name;
      // The same area regaining focus (a sheet or session closed) stays still.
      if (previous == null || previous === name) return;
      fade.value = 0;
      fade.value = withTiming(1, { duration: DURATION, easing: EASE });
    });
  }, [name, navigation, fade]);

  // Full radius within the first few points of travel, as in Claude and ChatGPT.
  const card = useAnimatedStyle(() => ({
    borderRadius: interpolate(drawer.value, [0, 0.02], [0, OPEN_RADIUS], "clamp"),
    shadowOpacity: interpolate(drawer.value, [0, 1], [0, OPEN_SHADOW]),
  }));
  const clip = useAnimatedStyle(() => ({
    borderRadius: interpolate(drawer.value, [0, 0.02], [0, OPEN_RADIUS], "clamp"),
  }));
  const content = useAnimatedStyle(() => ({ opacity: fade.value }));
  const wash = useAnimatedStyle(() => ({
    opacity: interpolate(drawer.value, [0, 1], [0, PAGE_FADE]),
  }));

  return (
    <Animated.View style={[styles.card, { backgroundColor: colors.bgCanvas }, card]}>
      <Animated.View style={[styles.clip, clip]}>
        <Animated.View style={[styles.fill, content]}>{children}</Animated.View>
        <Animated.View
          pointerEvents="none"
          style={[styles.wash, { backgroundColor: colors.bgRail }, wash]}
        />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    borderCurve: "continuous",
    shadowColor: "#000",
    shadowOffset: { width: -6, height: 0 },
    shadowRadius: 24,
  },
  clip: { flex: 1, overflow: "hidden", borderCurve: "continuous" },
  fill: { flex: 1 },
  wash: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
});
