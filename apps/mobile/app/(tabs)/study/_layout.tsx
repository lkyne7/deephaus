import { Stack } from "expo-router";
import { Platform } from "react-native";
import { nativeHeaderStyle } from "@/lib/header-options";
import { useTheme } from "@/lib/theme-context";

// Anchor the stack on its index so deep links and cross-tab replaces
// always have a screen to pop back to (keeps the native back button).
export const unstable_settings = {
  initialRouteName: "index",
};

// The progress line is the only rule under the bar during a session. A swipe
// across the card grades it, so back stays on the screen edge.
const sessionHeader = {
  headerShadowVisible: false,
  scrollEdgeEffects: { top: "hidden" },
  fullScreenGestureEnabled: false,
} as const;

export default function StudyLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        // iOS uses the native navigation bar (Liquid Glass back/toolbar
        // buttons); Android keeps the custom PageHeader rendered in-screen.
        headerShown: Platform.OS === "ios",
        headerBackButtonDisplayMode: "minimal",
        ...nativeHeaderStyle(colors),
        // Native iOS 26 look: the bar is transparent glass and content
        // scrolls underneath (screens opt in via automatic content insets).
        headerTransparent: Platform.OS === "ios",
        contentStyle: { backgroundColor: colors.bgCanvas },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Decks", headerLargeTitle: true }} />
      <Stack.Screen
        name="[deckId]"
        options={{
          title: "Study session",
          animation: "slide_from_bottom",
          gestureEnabled: true,
          ...sessionHeader,
        }}
      />
      <Stack.Screen name="cram/index" options={{ title: "Cram" }} />
      <Stack.Screen name="cram/create" options={{ title: "New cram plan" }} />
      <Stack.Screen name="cram/[planId]/index" options={{ title: "Cram plan" }} />
      <Stack.Screen
        name="cram/[planId]/session"
        options={{ title: "Cram session", ...sessionHeader }}
      />
    </Stack>
  );
}
