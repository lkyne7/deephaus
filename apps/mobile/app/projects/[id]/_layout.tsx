import { Stack } from "expo-router";

export default function ProjectDetailLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: "#1a2332" },
        headerTintColor: "#e8edf4",
        contentStyle: { backgroundColor: "#0f1419" },
      }}
    />
  );
}
