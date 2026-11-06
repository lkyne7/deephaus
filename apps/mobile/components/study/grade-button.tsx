import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

export type GradeButtonProps = {
  label: string;
  interval: string;
  color: string;
  onPress: () => void;
};

/** One grade in the dock: label, next interval, colour mark. iOS uses grade-button.ios.tsx. */
export function GradeButton({ label, interval, color, onPress }: GradeButtonProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Grade ${label}, next review ${interval}`}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.interval} numberOfLines={1}>
        {interval}
      </Text>
      <View style={[styles.mark, { backgroundColor: color }]} />
    </Pressable>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    button: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 14,
    },
    pressed: {
      backgroundColor: colors.bgHover,
    },
    label: {
      fontSize: 15,
      lineHeight: 20,
      fontWeight: "500",
      color: colors.fgPrimary,
    },
    interval: {
      fontSize: 12,
      lineHeight: 16,
      color: colors.fgTertiary,
    },
    mark: {
      width: 18,
      height: 2,
      borderRadius: 1,
      marginTop: 5,
    },
  });
}
