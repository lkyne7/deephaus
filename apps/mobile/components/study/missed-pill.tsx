import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Icon } from "@/components/ui/icon";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

/** After grading Again: a quiet way back to the card just missed, explained. */
export function MissedPill({
  answer,
  onWhy,
  onDismiss,
}: {
  answer: string;
  onWhy: () => void;
  onDismiss: () => void;
}) {
  const { colors, shadows } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={[styles.pill, shadows.md]} accessibilityRole="summary">
      <View style={styles.dot} />
      <Text style={styles.text} numberOfLines={1}>
        Missed: {answer}
      </Text>
      <Pressable style={styles.why} onPress={onWhy} accessibilityRole="button" accessibilityLabel={`Why is it ${answer}?`}>
        <Icon name="sparkles" size={13} color={colors.fgPrimary} />
        <Text style={styles.whyText}>Why?</Text>
      </Pressable>
      <Pressable
        style={styles.close}
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        hitSlop={6}
      >
        <Icon name="close" size={12} color={colors.actionPrimaryFg} />
      </Pressable>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    pill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginHorizontal: 12,
      marginBottom: 8,
      paddingLeft: 14,
      paddingRight: 6,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: colors.actionPrimaryBg,
    },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.gradeAgain },
    text: { flex: 1, fontSize: 14, lineHeight: 19, color: colors.actionPrimaryFg },
    why: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      height: 34,
      paddingHorizontal: 14,
      borderRadius: 17,
      backgroundColor: colors.bgSurface,
    },
    whyText: { fontSize: 14, fontWeight: "600", color: colors.fgPrimary },
    close: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(127, 127, 127, 0.18)",
    },
  });
}
