import { Stack } from "expo-router";
import { Platform } from "react-native";
import { useTheme } from "@/lib/theme-context";

// Anchor the stack on its index so deep links and cross-tab replaces
// always have a screen to pop back to (keeps the native back button).
export const unstable_settings = {
  initialRouteName: "index",
};

export default function CreateLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        // iOS uses the native navigation bar (Liquid Glass back/toolbar
        // buttons); Android keeps the custom PageHeader rendered in-screen.
        headerShown: Platform.OS === "ios",
        headerBackButtonDisplayMode: "minimal",
        headerTintColor: colors.brand600,
        headerTitleStyle: { color: colors.fgPrimary },
        // Native iOS 26 look: transparent glass bar, content scrolls under.
        headerTransparent: Platform.OS === "ios",
        contentStyle: { backgroundColor: colors.bgCanvas },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Create" }} />
      <Stack.Screen name="import" options={{ title: "Import deck" }} />
      <Stack.Screen name="[id]/index" options={{ title: "Create" }} />
      <Stack.Screen name="[id]/review" options={{ title: "Review cards" }} />
    </Stack>
  );
}
