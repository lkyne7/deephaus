import { useMemo } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Card } from "@/components/ui/card";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

export type ExamStat = { label: string; value: string };

/** A row of small figures with their labels, divided by hairlines. */
export function ExamStatRow({
  stats,
  style,
}: {
  stats: readonly ExamStat[];
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <Card style={[styles.row, style]}>
      {stats.map((stat, index) => (
        <View
          key={stat.label}
          accessible
          accessibilityLabel={`${stat.label}: ${stat.value}`}
          style={[styles.box, index > 0 && styles.boxDivider]}
        >
          <Text
            style={styles.value}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
          >
            {stat.value}
          </Text>
          <Text style={styles.label} numberOfLines={1}>
            {stat.label}
          </Text>
        </View>
      ))}
    </Card>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    row: { flexDirection: "row" },
    box: {
      flex: 1,
      minWidth: 0,
      paddingVertical: 12,
      paddingHorizontal: 10,
    },
    boxDivider: {
      borderLeftWidth: 1,
      borderLeftColor: colors.line,
    },
    value: {
      fontSize: 22,
      lineHeight: 28,
      fontWeight: "600",
      letterSpacing: -0.3,
      color: colors.fgPrimary,
    },
    label: {
      fontSize: 12,
      lineHeight: 16,
      color: colors.fgTertiary,
      marginTop: 2,
    },
  });
}
