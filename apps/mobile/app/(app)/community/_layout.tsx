import { Stack } from "expo-router";
import { sectionStackOptions } from "@/lib/header-options";
import { useTheme } from "@/lib/theme-context";

// Anchor the stack on its index so deep links and pushes from other areas
// always have a screen to pop back to (keeps the native back button).
export const unstable_settings = {
  initialRouteName: "index",
};

export default function CommunityLayout() {
  const { colors } = useTheme();
  return (
    <Stack screenOptions={sectionStackOptions(colors)}>
      <Stack.Screen name="index" options={{ title: "Community" }} />
      <Stack.Screen name="[publicationId]" options={{ title: "Deck preview" }} />
    </Stack>
  );
}
