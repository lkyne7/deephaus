import { useMemo, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/ui/button";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

/** Sans title with circular close, matching the system sheet header. */
export function SheetHeader({
  title,
  onClose,
  leading,
  trailing,
  closeDisabled,
}: {
  title?: string;
  onClose: () => void;
  leading?: ReactNode;
  trailing?: ReactNode;
  closeDisabled?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.row}>
      <View style={styles.side}>{leading}</View>
      <Text style={styles.title} numberOfLines={1} accessibilityRole="header">
        {title}
      </Text>
      <View style={[styles.side, styles.trailing]}>
        {trailing ?? (
          <Button
            variant="secondary"
            size="md"
            iconOnly
            leadingIcon="close"
            label="Close"
            onPress={onClose}
            disabled={closeDisabled}
          />
        )}
      </View>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      minHeight: 52,
      paddingHorizontal: 16,
      paddingTop: 14,
      paddingBottom: 6,
    },
    side: {
      minWidth: 72,
      flexDirection: "row",
      alignItems: "center",
    },
    trailing: { justifyContent: "flex-end" },
    title: {
      flex: 1,
      fontSize: 17,
      lineHeight: 22,
      fontWeight: "600",
      textAlign: "center",
      color: colors.fgPrimary,
    },
  });
}
