import { useEffect, type ReactNode } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

type Navigation = {
  addListener: (event: "focus", callback: () => void) => () => void;
  isFocused: () => boolean;
};

// The section on screen before the latest focus. A section that regains focus
// because a sheet or session above it closed is the same one, and stays still.
let currentSection: string | null = null;

// UIKit's deceleration curve, so the rise settles like a native push.
const EASE = Easing.bezier(0.2, 0.9, 0.3, 1);
const RISE = 48;
const DURATION = 360;

/**
 * Wraps each sidebar area. Choosing a new area from the sidebar slides it up
 * into place as the sidebar closes, the way Claude's app opens Chats. Runs on
 * the UI thread and follows the system's Reduce Motion setting.
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
  const progress = useSharedValue(1);

  useEffect(() => {
    // The area open at launch was focused before this listener existed.
    if (currentSection == null && navigation.isFocused()) currentSection = name;
    return navigation.addListener("focus", () => {
      const previous = currentSection;
      currentSection = name;
      // The same area regaining focus (a sheet or session closed) stays still.
      if (previous == null || previous === name) return;
      progress.value = 0;
        progress.value = withTiming(1, { duration: DURATION, easing: EASE });
    });
  }, [name, navigation, progress]);

  const animated = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * RISE }],
  }));

  return <Animated.View style={[styles.scene, animated]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({ scene: { flex: 1 } });
