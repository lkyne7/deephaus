import { Platform } from "react-native";
import type { ThemeColors } from "@/lib/theme";

/**
 * Native navigation bar styling shared by every stack: system title font, ink
 * bar buttons. Top-level tabs add `headerLargeTitle` in their own layouts.
 */
export function nativeHeaderStyle(colors: ThemeColors) {
  return {
    headerTintColor: colors.fgPrimary,
    headerTitleStyle: { color: colors.fgPrimary },
    headerLargeTitleStyle: { color: colors.fgPrimary },
  };
}

/**
 * Stack options for each area under the sidebar. iOS uses the native bar
 * (Liquid Glass buttons, content scrolling under a transparent bar); Android
 * keeps the custom PageHeader rendered in-screen.
 */
export function sectionStackOptions(colors: ThemeColors) {
  return {
    headerShown: Platform.OS === "ios",
    headerBackButtonDisplayMode: "minimal",
    ...nativeHeaderStyle(colors),
    headerTransparent: Platform.OS === "ios",
    contentStyle: { backgroundColor: colors.bgCanvas },
  } as const;
}
