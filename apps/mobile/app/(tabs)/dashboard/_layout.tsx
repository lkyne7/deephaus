import { Stack } from "expo-router";
import { Platform } from "react-native";
import { useTheme } from "@/lib/theme-context";

export default function DashboardLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        // iOS uses the native navigation bar (Liquid Glass toolbar buttons),
        // matching the other tabs; Android keeps the custom PageHeader.
        headerShown: Platform.OS === "ios",
        headerBackButtonDisplayMode: "minimal",
        headerTintColor: colors.brand600,
        headerTitleStyle: { color: colors.fgPrimary },
        // Native iOS 26 look: transparent glass bar, content scrolls under.
        headerTransparent: Platform.OS === "ios",
        contentStyle: { backgroundColor: colors.bgCanvas },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Dashboard" }} />
      <Stack.Screen
        name="stats"
        options={{
          title: "Stats",
          // Full-height page sheet: the previous formSheet detent clipped
          // the content and its drag gesture swallowed taps on the filter
          // chips.
          presentation: Platform.OS === "ios" ? "modal" : "card",
          // Sheets report window-level safe-area insets, so the transparent
          // header inset math doesn't hold — keep this bar opaque.
          headerTransparent: false,
        }}
      />
    </Stack>
  );
}
