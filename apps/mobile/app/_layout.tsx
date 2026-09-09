import {
  DarkTheme,
  DefaultTheme,
  Stack,
  ThemeProvider as NavigationThemeProvider,
  usePathname,
} from "expo-router";
import { StatusBar } from "expo-status-bar";
import { PostHogProvider } from "posthog-react-native";
import { useEffect, useMemo, useRef } from "react";
import { Platform, View } from "react-native";
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

  // Native navigation chrome (header/card backgrounds) reads colors from the
  // React Navigation theme, not our ThemeProvider — without this it stays on
  // the light default and headers render white in dark mode.
  const navigationTheme = useMemo(() => {
    const base = colorScheme === "dark" ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: colors.brand600,
        background: colors.bgCanvas,
        card: colors.bgSurface,
        text: colors.fgPrimary,
        border: colors.borderSecondary,
      },
    };
  }, [colorScheme, colors]);

  return (
    <NavigationThemeProvider value={navigationTheme}>
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
          <Stack.Screen
            name="search"
            options={{
              title: "Search",
              // Page sheet so swipe-down dismisses even when Expo Go opened
              // the route without navigation history (router.back() is empty).
              presentation: Platform.OS === "ios" ? "modal" : "card",
              gestureEnabled: true,
              headerShown: Platform.OS === "ios",
              headerTintColor: colors.brand600,
              headerTitleStyle: { color: colors.fgPrimary },
            }}
          />
          <Stack.Screen
            name="profile"
            options={{
              title: "Profile",
              // Native navigation bar on iOS (Liquid Glass back button);
              // Android keeps the custom PageHeader rendered in-screen.
              headerShown: Platform.OS === "ios",
              headerBackButtonDisplayMode: "minimal",
              headerTintColor: colors.brand600,
              headerTitleStyle: { color: colors.fgPrimary },
              // Native iOS 26 look: transparent glass bar, content scrolls
              // under (the screen uses automatic content insets).
              headerTransparent: Platform.OS === "ios",
            }}
          />
        </Stack>
      </View>
    </NavigationThemeProvider>
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
