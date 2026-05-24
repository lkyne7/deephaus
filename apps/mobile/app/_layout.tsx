import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

export default function RootLayout() {
  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: "#1a2332" },
          headerTintColor: "#e8edf4",
          contentStyle: { backgroundColor: "#0f1419" },
        }}
      />
    </>
  );
}
