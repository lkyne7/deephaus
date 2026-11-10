import { ReauthenticationNotice } from "@/components/reauthentication-notice";
import { OfflineLibraryProvider } from "@/components/offline-library";
import {
  DarkTheme,
  DefaultTheme,
  Stack,
  ThemeProvider as NavigationThemeProvider,
  usePathname,
} from "expo-router";
import { StatusBar } from "expo-status-bar";
import { PostHogProvider } from "posthog-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { PowerSyncProvider } from "@/components/powersync-provider";
import { AuthProvider } from "@/lib/auth-context";
import { BackgroundTasksProvider } from "@/lib/background-tasks-context";
import { loadAppFonts } from "@/lib/fonts";
import { nativeHeaderStyle } from "@/lib/header-options";
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
  const insets = useSafeAreaInsets();
  const [hasNotices, setHasNotices] = useState(false);

  // Native navigation chrome (header/card backgrounds) reads colors from the
  // React Navigation theme, not our ThemeProvider — without this it stays on
  // the light default and headers render white in dark mode.
  const navigationTheme = useMemo(() => {
    const base = colorScheme === "dark" ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: colors.accent,
        background: colors.bgCanvas,
        card: colors.bgCanvas,
        text: colors.fgPrimary,
        border: colors.borderSecondary,
      },
    };
  }, [colorScheme, colors]);

  // iOS uses the native bar (Liquid Glass back button); Android keeps the
  // custom PageHeader. The progress line is the only rule under the bar, and a
  // swipe across the card grades it, so back stays on the screen edge.
  const sessionOptions = {
    headerShown: Platform.OS === "ios",
    headerBackButtonDisplayMode: "minimal",
    ...nativeHeaderStyle(colors),
    headerTransparent: Platform.OS === "ios",
    headerShadowVisible: false,
    scrollEdgeEffects: { top: "hidden" },
    animation: "slide_from_bottom",
    gestureEnabled: true,
    fullScreenGestureEnabled: false,
  } as const;

  return (
    <NavigationThemeProvider value={navigationTheme}>
      <View style={{ flex: 1, backgroundColor: colors.bgCanvas }}>
        <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
        <View style={{ paddingTop: hasNotices ? insets.top : 0 }}>
          <View onLayout={({ nativeEvent }) => setHasNotices(nativeEvent.layout.height > 0)}>
            <ReauthenticationNotice />
          </View>
        </View>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.bgCanvas },
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Screen name="(app)" />
          {/* Sessions sit above the sidebar, so closing one returns to wherever it started. */}
          <Stack.Screen
            name="study/[deckId]"
            options={{ ...sessionOptions, title: "Study session" }}
          />
          <Stack.Screen
            name="study/exam/[examId]"
            options={{ ...sessionOptions, title: "Exam session" }}
          />
          {/* Everything there is to study today: exams with cards ready, then decks. */}
          <Stack.Screen name="study/all" options={{ ...sessionOptions, title: "Today" }} />
          <Stack.Screen
            name="search"
            options={{
              title: "Search",
              // UIKit's own full-screen slide up, with the field's keyboard rising
              // alongside it, instead of a sheet that has to finish first.
              presentation: Platform.OS === "ios" ? "fullScreenModal" : "card",
              animation: Platform.OS === "ios" ? "slide_from_bottom" : "default",
              gestureEnabled: false,
              headerShown: false,
              contentStyle: { backgroundColor: colors.bgCanvas },
            }}
          />
          <Stack.Screen
            name="profile"
            options={{
              title: "Settings",
              // A native sheet over the sidebar on iOS, as in Claude's app:
              // swipe it down or tap Close to come back to where you were.
              presentation: Platform.OS === "ios" ? "modal" : "card",
              // Native navigation bar on iOS (Liquid Glass close button);
              // Android keeps the custom PageHeader rendered in-screen.
              headerShown: Platform.OS === "ios",
              headerBackButtonDisplayMode: "minimal",
              ...nativeHeaderStyle(colors),
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
  const [fontsSettled, setFontsSettled] = useState(false);

  useEffect(() => {
    void loadAppFonts().finally(() => setFontsSettled(true));
  }, []);

  // Bounded by the timeout in loadAppFonts; a failed load falls back to the
  // system serif rather than holding the app here.
  if (!fontsSettled) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaProvider>
      <PostHogProvider client={posthog} autocapture={false}>
        <ThemeProvider>
          <AuthProvider>
            <PowerSyncProvider>
              <OfflineLibraryProvider>
                <BackgroundTasksProvider>
                  <RootLayoutContent />
                </BackgroundTasksProvider>
              </OfflineLibraryProvider>
            </PowerSyncProvider>
          </AuthProvider>
        </ThemeProvider>
      </PostHogProvider>
    </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
export { ScreenErrorBoundary as ErrorBoundary } from '@/components/screen-error-boundary';
