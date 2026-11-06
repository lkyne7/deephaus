import { Stack } from "expo-router";
import { Platform } from "react-native";
import { nativeHeaderStyle } from "@/lib/header-options";
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
        ...nativeHeaderStyle(colors),
        // Native iOS 26 look: transparent glass bar, content scrolls under.
        headerTransparent: Platform.OS === "ios",
        contentStyle: { backgroundColor: colors.bgCanvas },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Home" }} />
      <Stack.Screen name="stats" options={{ title: "Insights" }} />
    </Stack>
  );
}
