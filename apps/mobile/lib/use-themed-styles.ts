import { useMemo } from "react";
import { StyleSheet, type ImageStyle, type TextStyle, type ViewStyle } from "react-native";
import { useTheme } from "@/lib/theme-context";
import type { ThemeColors } from "@/lib/theme";

type NamedStyles<T> = { [P in keyof T]: ViewStyle | TextStyle | ImageStyle };

export function useThemedStyles<T extends NamedStyles<T>>(
  factory: (colors: ThemeColors) => T,
): T {
  const { colors } = useTheme();
  return useMemo(() => StyleSheet.create(factory(colors)), [colors, factory]);
}
