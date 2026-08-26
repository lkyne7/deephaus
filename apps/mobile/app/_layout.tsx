import { Stack, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { PostHogProvider } from "posthog-react-native";
import { useEffect, useRef } from "react";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { PowerSyncProvider } from "@/components/powersync-provider";
import { AuthProvider } from "@/lib/auth-context";
import { BackgroundTasksProvider } from "@/lib/background-tasks-context";
import { posthog } from "@/lib/posthog";
import { ThemeProvider, useTheme } from "@/lib/theme-context";

/** Manual screen tracking driven by expo-router. */
function useScreenTracking() {
  const pathname = usePathname();
  const previousPathname = useRef<string | null>(null);

  useEffect(() => {
    if (previousPathname.current === pathname) return;
    posthog.screen(pathname, {
      previous_screen: previousPathname.current,
    });
    previousPathname.current = pathname;
  }, [pathname]);
}

function RootLayoutContent() {
  const { colors, colorScheme } = useTheme();
  useScreenTracking();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bgCanvas }}>
      <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bgCanvas },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="liquid-glass-diagnostic" />
      </Stack>
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <PostHogProvider client={posthog} autocapture={false}>
        <ThemeProvider>
          <AuthProvider>
            <PowerSyncProvider>
              <BackgroundTasksProvider>
                <RootLayoutContent />
              </BackgroundTasksProvider>
            </PowerSyncProvider>
          </AuthProvider>
        </ThemeProvider>
      </PostHogProvider>
    </SafeAreaProvider>
  );
}
