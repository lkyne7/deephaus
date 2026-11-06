import { Stack } from "expo-router";
import { Platform } from "react-native";
import { nativeHeaderStyle } from "@/lib/header-options";
import { useTheme } from "@/lib/theme-context";

// Anchor the stack on its index so deep links and cross-tab replaces
// always have a screen to pop back to (keeps the native back button).
export const unstable_settings = {
  initialRouteName: "index",
};

export default function BrowseLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        // iOS uses the native navigation bar (Liquid Glass back/toolbar
        // buttons); Android keeps the custom PageHeader rendered in-screen.
        headerShown: Platform.OS === "ios",
        headerBackButtonDisplayMode: "minimal",
        ...nativeHeaderStyle(colors),
        // Native iOS 26 look: transparent glass bar, content scrolls under.
        headerTransparent: Platform.OS === "ios",
        contentStyle: { backgroundColor: colors.bgCanvas },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Cards", headerLargeTitle: true }} />
      <Stack.Screen name="[cardId]" options={{ title: "Card" }} />
    </Stack>
  );
}
