import { useMemo } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon, type IconName } from "@/components/ui/icon";
import { useTheme } from "@/lib/theme-context";
import { radius, type ThemeColors } from "@/lib/theme";

export type BadgeTone =
  | "brand"
  | "blue"
  | "purple"
  | "orange"
  | "gray"
  | "again"
  | "hard"
  | "good"
  | "easy";

function badgePalette(colors: ThemeColors): Record<
  BadgeTone,
  { bg: string; fg: string; border: string }
> {
  return {
    brand: { bg: colors.accentSoft, fg: colors.accentInk, border: "transparent" },
    // One accent: the old blue and purple tones read as neutral pills.
    blue: { bg: colors.bgSunken, fg: colors.fgSecondary, border: "transparent" },
    purple: { bg: colors.bgSunken, fg: colors.fgSecondary, border: "transparent" },
    orange: { bg: colors.dueSoft, fg: colors.due, border: "transparent" },
    gray: { bg: colors.bgSunken, fg: colors.fgSecondary, border: "transparent" },
    // Grade hues are too light for text, so the label stays ink.
    again: { bg: colors.gradeAgainBg, fg: colors.fgError, border: "transparent" },
    hard: { bg: colors.bgSunken, fg: colors.fgSecondary, border: "transparent" },
    good: { bg: colors.accentSoft, fg: colors.accentInk, border: "transparent" },
    easy: { bg: colors.accentSoft, fg: colors.accentInk, border: "transparent" },
  };
}

type Props = {
  label: string;
  icon?: IconName;
  tone?: BadgeTone;
  showDot?: boolean;
  size?: "sm" | "md";
  style?: StyleProp<ViewStyle>;
};

export function BadgePill({ label, icon, tone = "brand", showDot, size = "sm", style }: Props) {
  const { colors } = useTheme();
  const palette = useMemo(() => badgePalette(colors)[tone], [colors, tone]);

  return (
    <View
      style={[
        styles.badge,
        size === "md" && styles.sizeMd,
        {
          backgroundColor: palette.bg,
          borderColor: palette.border,
        },
        style,
      ]}
    >
      {showDot && <View style={[styles.dot, { backgroundColor: palette.fg }]} />}
      {icon && <Icon name={icon} size={12} color={palette.fg} />}
      <Text style={[styles.label, { color: palette.fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 3,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  sizeMd: {
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 999,
  },
  label: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "500",
    letterSpacing: 0,
  },
});
