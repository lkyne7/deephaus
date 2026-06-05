import { useMemo } from "react";
import { StyleSheet, Text, type TextProps } from "react-native";
import { useTheme } from "@/lib/theme-context";
import type { ThemeColors } from "@/lib/theme";

type Variant = "title" | "subtitle" | "body" | "muted" | "caption" | "label";

type Props = TextProps & {
  variant?: Variant;
};

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    title: {
      fontSize: 20,
      lineHeight: 28,
      fontWeight: "600",
      color: colors.fgPrimary,
      letterSpacing: -0.2,
    },
    subtitle: {
      fontSize: 16,
      lineHeight: 24,
      fontWeight: "600",
      color: colors.fgPrimary,
    },
    body: {
      fontSize: 14,
      lineHeight: 20,
      color: colors.fgSecondary,
    },
    muted: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgTertiary,
    },
    caption: {
      fontSize: 12,
      lineHeight: 16,
      color: colors.fgSecondary,
    },
    label: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "500",
      color: colors.fgQuaternary,
      letterSpacing: 0,
    },
  });
}

export function UIText({ variant = "body", style, ...props }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <Text {...props} style={[styles[variant], style]} />;
}
