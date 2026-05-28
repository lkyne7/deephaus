import { useMemo } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon, type IconName } from "@/components/ui/icon";
import { useTheme } from "@/lib/theme-context";
import { radius, type ThemeColors } from "@/lib/theme";

export type BadgeTone = "brand" | "orange" | "gray" | "again" | "hard" | "good" | "easy";

function badgePalette(colors: ThemeColors): Record<
  BadgeTone,
  { bg: string; fg: string; border: string }
> {
  return {
    brand: { bg: colors.brand50, fg: colors.brand700, border: "transparent" },
    orange: { bg: colors.orange50, fg: colors.orange700, border: "transparent" },
    gray: { bg: colors.gray100, fg: colors.gray700, border: "transparent" },
    again: { bg: colors.gradeAgainBg, fg: colors.gradeAgain, border: colors.gradeAgainBorder },
    hard: { bg: colors.gradeHardBg, fg: colors.gradeHard, border: colors.gradeHardBorder },
    good: { bg: colors.gradeGoodBg, fg: colors.gradeGood, border: colors.gradeGoodBorder },
    easy: { bg: colors.gradeEasyBg, fg: colors.gradeEasy, border: colors.gradeEasyBorder },
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
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "600",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
});
