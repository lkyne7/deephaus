import { Stack } from "expo-router";
import { Platform } from "react-native";
import { useTheme } from "@/lib/theme-context";

export default function CommunityLayout() {
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
      <Stack.Screen name="index" options={{ title: "Community" }} />
      <Stack.Screen
        name="[publicationId]"
        options={{ title: "Deck preview" }}
      />
    </Stack>
  );
}
