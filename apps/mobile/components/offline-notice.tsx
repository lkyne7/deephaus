import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

/** Notice shown in place of online-only features while offline. */
export function OfflineNotice({ feature }: { feature: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.notice}>
      <FeaturedIcon icon="cloudOffline" variant="gray" size="lg" />
      <Text style={styles.title}>You&apos;re offline</Text>
      <Text style={styles.body}>
        {feature} needs an internet connection. Studying and editing your decks
        still works offline.
      </Text>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    notice: {
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 32,
      paddingVertical: 40,
    },
    title: {
      fontSize: 17,
      lineHeight: 22,
      fontWeight: "600",
      color: colors.fgPrimary,
      marginTop: 10,
    },
    body: {
      fontSize: 14,
      lineHeight: 20,
      color: colors.fgTertiary,
      textAlign: "center",
    },
  });
}
