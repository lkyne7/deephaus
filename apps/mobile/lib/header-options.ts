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
