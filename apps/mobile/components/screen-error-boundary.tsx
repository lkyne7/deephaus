import { useEffect } from "react";
import { Text, Pressable, View } from "react-native";
import type { ErrorBoundaryProps } from "expo-router";
import { posthog } from "@/lib/posthog";
export function ScreenErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    posthog.captureException(error, {
      surface: "screen",
      release: process.env.EXPO_PUBLIC_RELEASE_ID ?? "development",
    });
  }, [error]);
  return (
    <View
      style={{
        flex: 1,
        justifyContent: "center",
        padding: 24,
        backgroundColor: "#fff",
      }}
    >
      <Text accessibilityRole="header" style={{ fontSize: 22, color: "#111" }}>
        This screen could not load
      </Text>
      <Text style={{ color: "#333", marginVertical: 16 }}>
        Your locally saved work is still on this device.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Try again"
        onPress={retry}
        style={{ minHeight: 48, justifyContent: "center" }}
      >
        <Text style={{ color: "#2463eb" }}>Try again</Text>
      </Pressable>
    </View>
  );
}
