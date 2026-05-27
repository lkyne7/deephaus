import { Stack } from "expo-router";
import { theme } from "@/lib/theme";

export default function StudyLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTintColor: theme.colors.text,
        contentStyle: { backgroundColor: theme.colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Study" }} />
      <Stack.Screen name="[deckId]" options={{ title: "Study session" }} />
    </Stack>
  );
}
