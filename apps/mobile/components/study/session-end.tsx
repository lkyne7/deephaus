import { useMemo, type ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { REVIEW_GRADES, gradeColor } from "@/components/study/review-dock";
import { BrandMark } from "@/components/ui/brand-mark";
import { serifFont } from "@/lib/fonts";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

type GradeCounts = { again: number; hard: number; good: number; easy: number };

/** End of a session: mark, serif headline, grade split, then any note and actions. */
export function SessionEnd({
  title,
  subtitle,
  grades,
  note,
  actions,
}: {
  title: string;
  subtitle?: string;
  grades?: GradeCounts;
  note?: ReactNode;
  actions: ReactNode;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const total = grades ? grades.again + grades.hard + grades.good + grades.easy : 0;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <BrandMark size={38} />
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}

      {grades && total > 0 ? (
        <View style={styles.gradeBlock}>
          <View style={styles.gradeBar}>
            {REVIEW_GRADES.filter((g) => grades[g.id] > 0).map((g) => (
              <View
                key={g.id}
                style={{ flex: grades[g.id], backgroundColor: gradeColor(colors, g.id) }}
              />
            ))}
          </View>
          <View style={styles.legend}>
            {REVIEW_GRADES.map((g) => (
              <View key={g.id} style={styles.legendItem}>
                <View style={[styles.legendSwatch, { backgroundColor: gradeColor(colors, g.id) }]} />
                <Text style={styles.legendLabel}>{g.label}</Text>
                <Text style={styles.legendValue}>{grades[g.id]}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {note ? <View style={styles.note}>{note}</View> : null}
      <View style={styles.actions}>{actions}</View>
    </ScrollView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bgCanvas },
    content: {
      flexGrow: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 24,
      paddingVertical: 32,
    },
    title: {
      ...serifFont(),
      fontSize: 32,
      lineHeight: 38,
      letterSpacing: -0.4,
      textAlign: "center",
      color: colors.fgPrimary,
      marginTop: 16,
    },
    subtitle: {
      fontSize: 14,
      lineHeight: 20,
      textAlign: "center",
      color: colors.fgTertiary,
      marginTop: 6,
    },
    gradeBlock: {
      alignSelf: "stretch",
      marginTop: 24,
    },
    gradeBar: {
      flexDirection: "row",
      gap: 2,
      height: 26,
      borderRadius: radius.lg,
      overflow: "hidden",
    },
    legend: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "center",
      columnGap: 14,
      rowGap: 4,
      marginTop: 12,
    },
    legendItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
    },
    legendSwatch: {
      width: 9,
      height: 9,
      borderRadius: 2,
    },
    legendLabel: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgSecondary,
    },
    legendValue: {
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "500",
      color: colors.fgPrimary,
    },
    note: {
      alignSelf: "stretch",
      marginTop: 24,
      padding: 14,
      borderRadius: radius.xl2,
      backgroundColor: colors.bgSunken,
    },
    actions: {
      alignSelf: "stretch",
      marginTop: 24,
      gap: 8,
    },
  });
}
