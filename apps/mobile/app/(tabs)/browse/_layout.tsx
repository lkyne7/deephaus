import { Stack } from "expo-router";
import { theme } from "@/lib/theme";

export default function BrowseLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTintColor: theme.colors.text,
        contentStyle: { backgroundColor: theme.colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Browse" }} />
      <Stack.Screen name="[cardId]" options={{ title: "Card" }} />
    </Stack>
  );
}
