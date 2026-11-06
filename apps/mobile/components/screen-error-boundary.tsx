import { useEffect } from "react";
import { Text, Pressable, View } from "react-native";
import type { ErrorBoundaryProps } from "expo-router";
import { posthog } from "@/lib/posthog";
import { buttonRadius, lightColors as colors } from "@/lib/theme";

// Exported as the root ErrorBoundary, so it can render without ThemeProvider.
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
        backgroundColor: colors.bgCanvas,
      }}
    >
      <Text
        accessibilityRole="header"
        style={{
          fontSize: 22,
          lineHeight: 28,
          fontWeight: "600",
          letterSpacing: -0.3,
          color: colors.fgPrimary,
        }}
      >
        This screen could not load
      </Text>
      <Text
        style={{
          fontSize: 15,
          lineHeight: 22,
          color: colors.fgSecondary,
          marginTop: 8,
          marginBottom: 24,
        }}
      >
        Your locally saved work is still on this device.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Try again"
        onPress={retry}
        style={({ pressed }) => ({
          minHeight: 48,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: buttonRadius,
          backgroundColor: colors.actionPrimaryBg,
          opacity: pressed ? 0.8 : 1,
        })}
      >
        <Text
          style={{
            fontSize: 16,
            fontWeight: "500",
            color: colors.actionPrimaryFg,
          }}
        >
          Try again
        </Text>
      </Pressable>
    </View>
  );
}
