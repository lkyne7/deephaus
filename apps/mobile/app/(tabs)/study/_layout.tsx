import { Stack } from "expo-router";
import { useTheme } from "@/lib/theme-context";

export default function StudyLayout() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bgCanvas },
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen
        name="[deckId]"
        options={{
          presentation: "fullScreenModal",
          animation: "slide_from_bottom",
          gestureEnabled: true,
        }}
      />
    </Stack>
  );
}
