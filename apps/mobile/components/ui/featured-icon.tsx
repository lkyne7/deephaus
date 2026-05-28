import { useMemo } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon, type IconName } from "@/components/ui/icon";
import { useTheme } from "@/lib/theme-context";
import { radius, type ThemeColors } from "@/lib/theme";

export type FeaturedIconVariant = "brand" | "orange" | "gray" | "again" | "good" | "easy" | "hard";
export type FeaturedIconSize = "sm" | "md" | "lg" | "xl" | "2xl";

function paletteFor(colors: ThemeColors): Record<FeaturedIconVariant, { bg: string; fg: string }> {
  return {
    brand: { bg: colors.brand50, fg: colors.brand600 },
    orange: { bg: colors.orange50, fg: colors.orange700 },
    gray: { bg: colors.gray100, fg: colors.gray600 },
    again: { bg: colors.gradeAgainBg, fg: colors.gradeAgain },
    good: { bg: colors.gradeGoodBg, fg: colors.gradeGood },
    easy: { bg: colors.gradeEasyBg, fg: colors.gradeEasy },
    hard: { bg: colors.gradeHardBg, fg: colors.gradeHard },
  };
}

const SIZE: Record<FeaturedIconSize, { box: number; icon: number; radius: number }> = {
  sm: { box: 32, icon: 16, radius: radius.md },
  md: { box: 40, icon: 20, radius: radius.lg },
  lg: { box: 48, icon: 24, radius: radius.xl },
  xl: { box: 56, icon: 28, radius: radius.xl2 },
  "2xl": { box: 64, icon: 32, radius: radius.xl3 },
};

type Props = {
  icon: IconName;
  variant?: FeaturedIconVariant;
  size?: FeaturedIconSize;
  style?: StyleProp<ViewStyle>;
};

export function FeaturedIcon({ icon, variant = "brand", size = "md", style }: Props) {
  const { colors } = useTheme();
  const palette = useMemo(() => paletteFor(colors)[variant], [colors, variant]);
  const dims = SIZE[size];

  return (
    <View
      style={[
        {
          width: dims.box,
          height: dims.box,
          borderRadius: dims.radius,
          backgroundColor: palette.bg,
        },
        styles.box,
        style,
      ]}
    >
      <Icon name={icon} size={dims.icon} color={palette.fg} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: "center",
    justifyContent: "center",
  },
});
