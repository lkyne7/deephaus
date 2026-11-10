import { useMemo } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Button } from "@/components/ui/button";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

/**
 * What a list shows when loading it failed, so a failure never reads as
 * "nothing here yet" with the wrong call to action.
 */
export function LoadError({
  title,
  message = "Check your connection and try again.",
  onRetry,
  style,
}: {
  title: string;
  message?: string;
  onRetry: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={[styles.root, style]}>
      <FeaturedIcon icon="warning" variant="again" size="md" />
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{message}</Text>
      <Button
        variant="secondary"
        size="md"
        label="Try again"
        onPress={onRetry}
        style={styles.retry}
      />
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { alignItems: "center", gap: 6, paddingHorizontal: 32, paddingVertical: 40 },
    title: {
      fontSize: 17,
      lineHeight: 22,
      fontWeight: "600",
      color: colors.fgPrimary,
      marginTop: 10,
      textAlign: "center",
    },
    body: { fontSize: 14, lineHeight: 20, color: colors.fgTertiary, textAlign: "center" },
    retry: { marginTop: 12 },
  });
}
