import { Stack } from "expo-router";
import { theme } from "@/lib/theme";

export default function CreateLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.colors.surface },
        headerTintColor: theme.colors.text,
        contentStyle: { backgroundColor: theme.colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Create" }} />
      <Stack.Screen name="[id]/index" options={{ title: "Project" }} />
      <Stack.Screen name="[id]/review" options={{ title: "Review cards" }} />
    </Stack>
  );
}
